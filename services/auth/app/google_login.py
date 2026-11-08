"""MX-11: identidad Google OIDC, separada de la autorización para leer Gmail."""

from collections.abc import Mapping
from datetime import timedelta
from hashlib import sha256
import secrets
import time

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from redis.exceptions import RedisError
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from .contratos_auth import LoginRespuestaSerializer
from .models import IdentidadGoogle, IntentoGoogle, User
from .sesiones import emitir_tokens

COOKIE = "google_login_nonce"
VIGENCIA = 300


def huella(valor):
    return sha256(valor.encode()).hexdigest()


class GoogleSerializer(serializers.Serializer):
    id_token = serializers.CharField(max_length=8192, trim_whitespace=False)
    nonce = serializers.CharField(max_length=128, trim_whitespace=False)
    password = serializers.CharField(max_length=256, required=False, trim_whitespace=False, write_only=True)


class NonceSerializer(serializers.Serializer):
    nonce = serializers.CharField()
    client_id = serializers.CharField()
    vence_en_segundos = serializers.IntegerField()


class PeticionGoogle(Request):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 5
        return super().__call__(*args, **kwargs)


def verificar_identidad(token, nonce):
    # La librería oficial verifica firma, emisor, audiencia y vigencia.
    datos = id_token.verify_oauth2_token(token, PeticionGoogle(), settings.GOOGLE_CLIENT_ID)
    if (datos.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
        or datos.get("aud") != settings.GOOGLE_CLIENT_ID
        or datos.get("email_verified") is not True
        or not isinstance(datos.get("sub"), str)
        or not 1 <= len(datos["sub"].strip()) <= 255
        or not isinstance(datos.get("exp"), (int, float))
        or isinstance(datos["exp"], bool) or datos["exp"] <= time.time()
        or datos.get("nonce") != nonce):
        raise ValueError("Identidad Google inválida")
    validate_email(datos.get("email", ""))
    return datos


class GoogleNonceView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Auth"], responses={200: NonceSerializer, 503: None})
    def get(self, request):
        if not settings.GOOGLE_CLIENT_ID:
            return Response({"code": "google_no_configurado"}, status=503)
        nonce, navegador = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        IntentoGoogle.objects.filter(vence_en__lte=timezone.now()).delete()
        IntentoGoogle.objects.create(
            huella=huella(nonce), navegador=huella(navegador),
            vence_en=timezone.now() + timedelta(seconds=VIGENCIA),
        )
        respuesta = Response({"nonce": nonce, "client_id": settings.GOOGLE_CLIENT_ID,
                              "vence_en_segundos": VIGENCIA})
        respuesta.set_cookie(COOKIE, navegador, max_age=VIGENCIA, httponly=True,
                             secure=not settings.DEBUG, samesite="Lax", path="/api/auth/google/")
        respuesta["Cache-Control"] = "no-store"
        return respuesta


class GoogleLoginView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Auth"], request=GoogleSerializer,
                   responses={200: LoginRespuestaSerializer, 400: None, 401: None, 409: None, 503: None},
                   description="Valida ID token OIDC con nonce de un uso. Primera vinculación exige password local. No registra cuentas.")
    def post(self, request):
        if not settings.GOOGLE_CLIENT_ID:
            return Response({"code": "google_no_configurado"}, status=503)
        if isinstance(request.data, Mapping) and request.data.get("error") in ("access_denied", "cancelled"):
            return Response({"code": "google_cancelado", "detail": "Inicio con Google cancelado."}, status=400)
        formulario = GoogleSerializer(data=request.data)
        formulario.is_valid(raise_exception=True)
        datos = formulario.validated_data
        try:
            identidad = verificar_identidad(datos["id_token"], datos["nonce"])
            with transaction.atomic():
                intento = IntentoGoogle.objects.select_for_update().filter(huella=huella(datos["nonce"])).first()
                navegador = request.COOKIES.get(COOKIE, "")
                if (not intento or intento.vence_en <= timezone.now() or not navegador
                    or not secrets.compare_digest(intento.navegador, huella(navegador))):
                    return Response({"code": "google_invalido"}, status=401)
                intento.delete()
                vinculada = IdentidadGoogle.objects.filter(subject=identidad["sub"]).first()
                if vinculada:
                    usuario = User.objects.select_for_update().filter(pk=vinculada.usuario_id, is_active=True).first()
                else:
                    usuario = User.objects.select_for_update().filter(email__iexact=identidad["email"], is_active=True).first()
                    if usuario is None:
                        return Response({"code": "completar_registro", "detail": "Completa el registro y acepta el tratamiento de datos."}, status=409)
                    # Coincidir por correo no vincula identidades: exige prueba local.
                    if not usuario.check_password(datos.get("password", "")):
                        return Response({"code": "vincular_google", "detail": "Confirma tu contraseña para vincular Google."}, status=401)
                    if IdentidadGoogle.objects.filter(usuario=usuario).exists():
                        return Response({"code": "google_invalido"}, status=401)
                    IdentidadGoogle.objects.create(usuario=usuario, subject=identidad["sub"])
                if usuario is None:
                    return Response({"code": "google_invalido"}, status=401)
                tokens = emitir_tokens(usuario, proveedor="google")
            respuesta = Response({**tokens, "usuario": {"id": usuario.pk, "nombre": usuario.nombre, "correo": usuario.email}})
            respuesta.delete_cookie(COOKIE, path="/api/auth/google/", samesite="Lax")
            respuesta["Cache-Control"] = "no-store"
            return respuesta
        except (ValueError, TypeError, ValidationError, IntegrityError):
            return Response({"code": "google_invalido", "detail": "No se pudo validar la identidad de Google."}, status=401)
        except (GoogleAuthError, RedisError, OSError):
            return Response({"code": "google_no_disponible", "detail": "No se pudo iniciar sesión. Inténtalo nuevamente."}, status=503)

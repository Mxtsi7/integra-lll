"""Sesiones por dispositivo: refresh de un uso y revocación inmediata."""

from datetime import datetime, timezone as tz

from django.core.cache import caches
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from redis.exceptions import RedisError
from drf_spectacular.utils import extend_schema

from shared.sesiones import registrar_credenciales, sesion_activa
from .models import Sesion, User


def emitir_tokens(usuario, *, sesion=None, version=None, proveedor="local"):
    refresh = RefreshToken.for_user(usuario)
    refresh["session_version"] = version or registrar_credenciales(usuario)
    refresh["organizacion_id"] = str(usuario.organizacion_id) if usuario.organizacion_id else None
    refresh["rol"] = usuario.rol
    refresh["proveedor"] = proveedor
    if sesion is None:
        sesion = Sesion.objects.create(
            usuario=usuario, refresh_jti=refresh["jti"],
            vence_en=datetime.fromtimestamp(refresh["exp"], tz=tz.utc),
        )
    else:
        # La rotación no prolonga indefinidamente la sesión inicial.
        refresh["exp"] = int(sesion.vence_en.timestamp())
        sesion.refresh_jti = refresh["jti"]
        sesion.save(update_fields=["refresh_jti"])
    refresh["sid"] = str(sesion.pk)
    caches["sesiones"].set(
        f"sesion:{sesion.pk}", [str(usuario.pk), refresh["session_version"]],
        timeout=max(1, int((sesion.vence_en - timezone.now()).total_seconds())),
    )
    return {"access_token": str(refresh.access_token), "refresh_token": str(refresh)}


class RefreshSerializer(serializers.Serializer):
    refresh_token = serializers.CharField(max_length=4096, trim_whitespace=False)


class TokensSerializer(serializers.Serializer):
    access_token = serializers.CharField()
    refresh_token = serializers.CharField()


def revocar(sesion):
    caches["sesiones"].delete(f"sesion:{sesion.pk}")
    sesion.revocada = True
    sesion.save(update_fields=["revocada"])


class RefreshView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Auth"], request=RefreshSerializer,
                   responses={200: TokensSerializer, 400: None, 401: None, 503: None})
    def post(self, request):
        datos = RefreshSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        try:
            token = RefreshToken(datos.validated_data["refresh_token"])
            with transaction.atomic():
                usuario = User.objects.select_for_update().filter(pk=token.get("user_id"), is_active=True).first()
                sesion = Sesion.objects.select_for_update().filter(pk=token.get("sid"), usuario=usuario).first()
                if not usuario or not sesion or sesion.revocada or sesion.vence_en <= timezone.now():
                    return Response({"detail": "Sesión inválida. Inicia sesión nuevamente."}, status=401)
                if (sesion.refresh_jti != token["jti"] or
                    token.get("organizacion_id") != (str(usuario.organizacion_id) if usuario.organizacion_id else None) or
                    token.get("rol") != usuario.rol or
                    not sesion_activa(usuario.pk, token.get("session_version"), token.get("sid"))):
                    # Reutilizar un refresh cierra también el access de su familia.
                    revocar(sesion)
                    return Response({"detail": "Sesión inválida. Inicia sesión nuevamente."}, status=401)
                return Response(emitir_tokens(usuario, sesion=sesion, version=token["session_version"],
                                             proveedor=token.get("proveedor", "local")))
        except (TokenError, ValueError, TypeError, ValidationError):
            return Response({"detail": "Refresh inválido. Inicia sesión nuevamente."}, status=401)
        except (RedisError, OSError):
            return Response({"detail": "No se pudo comprobar la sesión."}, status=503)


class LogoutView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Auth"], request=None, responses={204: None, 401: None, 503: None})
    def post(self, request):
        try:
            with transaction.atomic():
                usuario = User.objects.select_for_update().filter(pk=request.headers.get("X-Usuario-Id"), is_active=True).first()
                sesion = Sesion.objects.select_for_update().filter(
                    pk=request.headers.get("X-Sesion-Id"), usuario=usuario,
                ).first()
                if not usuario or not sesion:
                    return Response({"detail": "Falta una sesión válida."}, status=401)
                revocar(sesion)
            return Response(status=204)
        except (ValueError, TypeError, ValidationError):
            return Response({"detail": "Falta una sesión válida."}, status=401)
        except (RedisError, OSError):
            return Response({"detail": "No se pudo cerrar la sesión."}, status=503)

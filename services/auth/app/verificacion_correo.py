"""Verificación y cambio de correo: secreto de propósito único, guardado como huella."""

from datetime import timedelta
from hashlib import sha256
import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied

from .models import SolicitudVerificacionCorreo, User

MINUTOS_VALIDEZ = 60
SEGUNDOS_REENVIO = 60
MAXIMOS_POR_HORA = 5
PREFIJO_TOKEN = "verificar_correo:"


class ErrorVerificacionCorreo(Exception):
    def __init__(self, codigo, detalle, estado_http=400):
        self.respuesta = {"code": codigo, "detail": detalle}
        self.estado_http = estado_http
        super().__init__(detalle)


def huella(valor):
    return sha256(valor.encode("utf-8")).hexdigest()


def enviar_correo(destino, asunto, mensaje):
    if not send_mail(asunto, mensaje, settings.DEFAULT_FROM_EMAIL, [destino], fail_silently=False):
        raise OSError("No se pudo entregar el correo")


@transaction.atomic
def solicitar_verificacion(usuario_id, correo=None, password=None):
    if not usuario_id or not str(usuario_id).isascii() or not str(usuario_id).isdigit() or len(str(usuario_id)) > 19 or not 0 < int(usuario_id) <= 2**63 - 1:
        raise PermissionDenied("Falta el contexto de usuario válido")
    usuario = User.objects.select_for_update().filter(pk=usuario_id, is_active=True).first()
    if usuario is None:
        raise NotFound("El usuario no existe")
    destino = (correo or usuario.email).lower()
    if destino != usuario.email.lower() and (not password or not usuario.check_password(password)):
        raise ErrorVerificacionCorreo("identidad_invalida", "Confirma tu contraseña actual para cambiar el correo.")
    if User.objects.filter(email__iexact=destino).exclude(pk=usuario.pk).exists():
        raise ErrorVerificacionCorreo("correo_no_disponible", "El correo no está disponible.")
    ahora = timezone.now()
    solicitudes = usuario.verificaciones_correo
    recientes = solicitudes.filter(creado_en__gt=ahora - timedelta(hours=1))
    if solicitudes.filter(creado_en__gt=ahora - timedelta(seconds=SEGUNDOS_REENVIO)).exists() or recientes.count() >= MAXIMOS_POR_HORA:
        raise ErrorVerificacionCorreo("limite_reenvio", "Espera antes de solicitar otro enlace.", 429)
    token = PREFIJO_TOKEN + secrets.token_urlsafe(32)
    solicitudes.filter(consumido_en=None, invalidado_en=None).update(invalidado_en=ahora)
    SolicitudVerificacionCorreo.objects.create(
        usuario=usuario, huella=huella(token), correo=destino, correo_anterior=usuario.email,
        credenciales=huella(usuario.password), vence_en=ahora + timedelta(minutes=MINUTOS_VALIDEZ),
    )
    enlace = f"{settings.FRONTEND_URL.rstrip('/')}/verificar-correo?{urlencode({'token': token})}"
    enviar_correo(destino, "Verifica tu correo · Ojo al Gasto", f"Verifica esta dirección dentro de {MINUTOS_VALIDEZ} minutos:\n\n{enlace}\n\nSi no solicitaste este cambio, ignora el mensaje.")


@transaction.atomic
def confirmar_verificacion(token):
    invalido = ErrorVerificacionCorreo("token_invalido", "El enlace no es válido. Solicita uno nuevo.")
    if not isinstance(token, str) or not token.isascii() or not token.startswith(PREFIJO_TOKEN) or len(token) > 128:
        raise invalido
    solicitud = SolicitudVerificacionCorreo.objects.filter(huella=huella(token)).first()
    if solicitud is None:
        raise invalido
    # Mismo orden de bloqueo que solicitud/reenvío: usuario, luego token.
    usuario = User.objects.select_for_update().filter(pk=solicitud.usuario_id, is_active=True).first()
    if usuario is None:
        raise invalido
    solicitud = SolicitudVerificacionCorreo.objects.select_for_update().get(pk=solicitud.pk)
    if solicitud.consumido_en:
        raise ErrorVerificacionCorreo("token_usado", "El enlace ya fue utilizado. Solicita uno nuevo.", 410)
    if solicitud.invalidado_en or solicitud.correo_anterior != usuario.email or solicitud.credenciales != huella(usuario.password):
        raise invalido
    ahora = timezone.now()
    if ahora >= solicitud.vence_en:
        raise ErrorVerificacionCorreo("token_expirado", "El enlace venció. Solicita uno nuevo.", 410)
    if User.objects.filter(email__iexact=solicitud.correo).exclude(pk=usuario.pk).exists():
        raise ErrorVerificacionCorreo("correo_no_disponible", "El correo no está disponible.")
    anterior = usuario.email
    usuario.email = solicitud.correo
    usuario.correo_verificado_en = ahora
    try:
        with transaction.atomic():
            usuario.save(update_fields=["email", "correo_verificado_en"])
    except IntegrityError:
        # Dos usuarios pueden confirmar el mismo destino a la vez.
        raise ErrorVerificacionCorreo("correo_no_disponible", "El correo no está disponible.") from None
    if anterior.lower() != usuario.email.lower():
        enviar_correo(anterior, "Cambio de correo · Ojo al Gasto", "Se verificó y cambió el correo de tu cuenta. Si no solicitaste el cambio, contacta al soporte.")
    solicitud.consumido_en = ahora
    solicitud.save(update_fields=["consumido_en"])

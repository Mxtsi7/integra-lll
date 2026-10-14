"""Recuperación de contraseña: token temporal y envío del enlace.

El token nunca se escribe en logs: solo viaja dentro del correo.
"""

import logging
from hashlib import sha256
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import send_mail
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.crypto import constant_time_compare
from django.utils.http import (
    base36_to_int,
    urlsafe_base64_decode,
    urlsafe_base64_encode,
)

from .models import TokenRecuperacionUsado, User
from shared.sesiones import registrar_credenciales

logger = logging.getLogger(__name__)

# Separa el uid del token dentro del único parámetro `token` que lee la web
# (RestablecerContrasenaPage). Ni base64 url-safe ni el token usan el punto.
SEPARADOR = "."


class ErrorTokenRecuperacion(Exception):
    ERRORES = {
        "token_invalido": (400, "El enlace no es válido. Solicita uno nuevo."),
        "token_expirado": (410, "El enlace venció. Solicita uno nuevo."),
        "token_usado": (410, "El enlace ya fue utilizado. Solicita uno nuevo."),
    }

    def __init__(self, codigo):
        self.codigo = codigo
        self.estado_http, self.detalle = self.ERRORES[codigo]
        super().__init__(self.detalle)

    @property
    def respuesta(self):
        return {
            "code": self.codigo,
            "detail": self.detalle,
            "solicitar_nuevo_enlace": "/api/auth/password-reset/",
        }


class TokenRecuperacion(PasswordResetTokenGenerator):
    """Token firmado con SECRET_KEY, de un solo uso y con caducidad fija.

    El hash incluye el hash de la contraseña y `last_login`, así que cambiar
    la clave o actualizar `last_login` invalida el token sin guardarlo en BD.
    """

    key_salt = "app.recuperacion.TokenRecuperacion"

    def check_token(self, user: User | None, token: str | None) -> bool:
        return self.motivo_invalidez(user, token) is None

    def motivo_invalidez(self, user, token):
        # Verificar la firma ANTES de clasificar la edad. Un timestamp
        # alterado no permite descubrir nada del usuario ni fingir caducidad.
        if not user or not token:
            return "token_invalido"
        try:
            ts_b36, _ = token.split("-")
            ts = base36_to_int(ts_b36)
        except ValueError:
            return "token_invalido"
        if not any(
            constant_time_compare(self._make_token_with_timestamp(user, ts, secret), token)
            for secret in [self.secret, *self.secret_fallbacks]
        ):
            return "token_invalido"
        edad = self._num_seconds(self._now()) - ts
        if edad < 0:
            return "token_invalido"
        limite = min(settings.PASSWORD_RESET_TIMEOUT, settings.RECUPERACION_MINUTOS * 60)
        return "token_expirado" if edad >= limite else None


generador_token = TokenRecuperacion()


def generar_token_compuesto(user: User) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return f"{uid}{SEPARADOR}{generador_token.make_token(user)}"


def usuario_desde_token(token_compuesto: str, *, bloquear=False) -> User | None:
    """Devuelve el usuario si el token es válido y vigente; si no, None."""
    try:
        return validar_token_recuperacion(token_compuesto, bloquear=bloquear)
    except ErrorTokenRecuperacion:
        return None


def validar_token_recuperacion(token_compuesto: str, *, bloquear=False) -> User:
    if not isinstance(token_compuesto, str) or not token_compuesto.isascii() or len(token_compuesto) > 512:
        raise ErrorTokenRecuperacion("token_invalido")
    uid_b64, _, token = token_compuesto.partition(SEPARADOR)
    if not uid_b64 or not token:
        raise ErrorTokenRecuperacion("token_invalido")
    try:
        pk = force_str(urlsafe_base64_decode(uid_b64))
        if not pk.isascii() or not pk.isdigit() or len(pk) > 19 or not 0 < int(pk) <= 2**63 - 1:
            raise ValueError
        if uid_b64 != urlsafe_base64_encode(force_bytes(str(int(pk)))):
            raise ValueError
        usuarios = User.objects.select_for_update() if bloquear else User.objects
        user = usuarios.get(pk=pk, is_active=True)
    except (ValueError, User.DoesNotExist):
        raise ErrorTokenRecuperacion("token_invalido") from None
    if not user.has_usable_password():
        raise ErrorTokenRecuperacion("token_invalido")
    if TokenRecuperacionUsado.objects.filter(huella=huella_token(token_compuesto)).exists():
        raise ErrorTokenRecuperacion("token_usado")
    motivo = generador_token.motivo_invalidez(user, token)
    if motivo:
        raise ErrorTokenRecuperacion(motivo)
    return user


def huella_token(token_compuesto):
    return sha256(token_compuesto.encode("ascii")).hexdigest()


@transaction.atomic
def confirmar_recuperacion(token_compuesto: str, password: str) -> bool:
    # El segundo intento espera el bloqueo y valida contra el hash ya cambiado.
    user = validar_token_recuperacion(token_compuesto, bloquear=True)
    user.set_password(password)
    # Revocar ANTES de persistir: si Redis falla, atomic revierte el cambio.
    # Si falla el commit, solo se cierran sesiones; el próximo login restaura
    # la versión de la contraseña que realmente quedó guardada.
    registrar_credenciales(user)
    user.save(update_fields=["password"])
    TokenRecuperacionUsado.objects.create(huella=huella_token(token_compuesto))
    return True


def construir_enlace(token_compuesto: str) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}/restablecer-contrasena?{urlencode({'token': token_compuesto})}"


def enviar_correo_recuperacion(user: User) -> None:
    enlace = construir_enlace(generar_token_compuesto(user))
    send_mail(
        subject="Recupera tu contraseña · Ojo al Gasto",
        message=(
            f"Hola {user.nombre},\n\n"
            "Recibimos una solicitud para restablecer tu contraseña. "
            f"Usa este enlace dentro de los próximos {settings.RECUPERACION_MINUTOS} minutos:\n\n"
            f"{enlace}\n\n"
            "Si no fuiste tú, ignora este correo."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )
    # Solo el id: ni el token ni el enlace.
    logger.info("Correo de recuperación enviado al usuario id=%s", user.pk)


def solicitar_recuperacion(email: str) -> None:
    """Envía el correo si el usuario existe y está activo; si no, no hace nada.

    Nunca lanza: la vista responde lo mismo en todos los casos.
    """
    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if user is None or not user.has_usable_password():
        return
    try:
        enviar_correo_recuperacion(user)
    except Exception:
        # Sin exc_info: el traceback podría arrastrar el cuerpo del correo.
        logger.error("Falló el envío del correo de recuperación (usuario id=%s)", user.pk)


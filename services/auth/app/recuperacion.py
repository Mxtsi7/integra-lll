"""Recuperación de contraseña: token temporal y envío del enlace.

El token nunca se escribe en logs: solo viaja dentro del correo.
"""

import logging
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import (
    base36_to_int,
    urlsafe_base64_decode,
    urlsafe_base64_encode,
)

from .models import User

logger = logging.getLogger(__name__)

# Separa el uid del token dentro del único parámetro `token` que lee la web
# (RestablecerContrasenaPage). Ni base64 url-safe ni el token usan el punto.
SEPARADOR = "."


class TokenRecuperacion(PasswordResetTokenGenerator):
    """Token firmado con SECRET_KEY, de un solo uso y con caducidad fija.

    El hash incluye el hash de la contraseña y `last_login`, así que cambiar
    la clave o actualizar `last_login` invalida el token sin guardarlo en BD.
    """

    key_salt = "app.recuperacion.TokenRecuperacion"

    def check_token(self, user: User | None, token: str | None) -> bool:
        if not super().check_token(user, token):
            return False
        # Doble control: aunque alguien suba PASSWORD_RESET_TIMEOUT, el token
        # de recuperación no vive más de RECUPERACION_MINUTOS.
        try:
            ts = base36_to_int(token.split("-")[0])
        except ValueError:
            return False
        edad = self._num_seconds(self._now()) - ts
        return 0 <= edad < settings.RECUPERACION_MINUTOS * 60


generador_token = TokenRecuperacion()


def generar_token_compuesto(user: User) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return f"{uid}{SEPARADOR}{generador_token.make_token(user)}"


def usuario_desde_token(token_compuesto: str) -> User | None:
    """Devuelve el usuario si el token es válido y vigente; si no, None."""
    uid_b64, _, token = token_compuesto.partition(SEPARADOR)
    if not uid_b64 or not token:
        return None
    try:
        pk = force_str(urlsafe_base64_decode(uid_b64))
        user = User.objects.get(pk=pk, is_active=True)
    except (ValueError, User.DoesNotExist):
        return None
    if not user.has_usable_password():
        return None
    return user if generador_token.check_token(user, token) else None


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

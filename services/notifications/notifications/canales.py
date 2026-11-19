"""Los canales que entregan hacia afuera (S3-FE-21). Hoy, solo el correo.

Un canal sabe dos cosas: **a dónde** mandarle a una persona y **cómo**
mandarlo. Lo demás —preferencias, descanso, cuota, reintentos, qué se anota—
lo decide `entregas.py`, igual para todos.

── El correo ────────────────────────────────────────────────────────────────
Es el canal que respaldan los documentos: RF-09 dice que «el correo siempre
está disponible como canal; el push es adicional en el móvil»,
`CANALES_HABILITADOS` trae `email` por omisión desde FE-21, y `.env.example`
ya tiene la sección «Correo (servicios auth y notifications)». No hay un
acuerdo escrito propio de S3-FE-21: lo valida quien recibe la entrega. De
dónde sale la DIRECCIÓN tampoco está acordado (ver `DireccionCorreo`). Se manda con el backend de correo de
Django y las MISMAS variables que usa auth para recuperar la contraseña
(`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`,
`EMAIL_USE_TLS`, `EMAIL_USE_SSL`, `EMAIL_TIMEOUT`, `DEFAULT_FROM_EMAIL`).

Con el backend SMTP, `send()` devuelve 1 solo si el servidor respondió 250
al mensaje; cualquier otra respuesta es una excepción de `smtplib`. Esa
respuesta es la aceptación del proveedor. El texto de la respuesta Django no
lo expone, así que la evidencia es el Message-ID: lo ponemos nosotros, va en
el mensaje y con él se encuentra en el buzón de envío del proveedor (en
Gmail, `rfc822msgid:<id>`).

── El push ──────────────────────────────────────────────────────────────────
ADR-006 lo acordó con el servicio de notificaciones de Expo, pero no hay
proveedor configurado ni registro de dispositivos: no hay a quién ni cómo
mandarlo. No está en `CANALES`, y una entrega por push termina en `fallida`
con `canal_no_disponible`. No se simula: un push "enviado" sin proveedor
sería declarar entregado algo que no salió.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.utils import parseaddr

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.mail import BadHeaderError, EmailMessage
from django.core.validators import validate_email

from .models import DireccionCorreo

#: Lo que cabe en `EntregaAlerta.detalle_error`.
LARGO_DETALLE = 300


class ErrorDeEnvio(Exception):
    """Un fallo con código. `permanente` decide si vale la pena reintentar."""

    def __init__(self, codigo: str, detalle: str = "", *, permanente: bool):
        super().__init__(codigo)
        self.codigo = codigo
        self.detalle = detalle[:LARGO_DETALLE]
        self.permanente = permanente


@dataclass(frozen=True)
class Envio:
    """Lo que se manda. Sin la alerta ni la fila: el canal no las necesita."""

    destino: str
    asunto: str
    cuerpo: str
    message_id: str


def _texto(respuesta) -> str:
    if isinstance(respuesta, bytes):
        return respuesta.decode("utf-8", errors="replace")
    return str(respuesta)


def clasificar_smtp(error: Exception) -> ErrorDeEnvio:
    """Traduce una excepción de `smtplib` o de red a un `ErrorDeEnvio`.

    Permanente es solo lo que dice algo del DESTINATARIO o del MENSAJE, con
    un código 5xx: el servidor lo rechazó y mandarlo igual otra vez da lo
    mismo. Todo lo demás es transitorio:

    · 4xx: el propio protocolo dice "inténtalo después";
    · desconexión, conexión rechazada, tiempo agotado: no se sabe si el
      servidor lo procesó (un timeout no demuestra que no llegó), y por eso
      el reintento lleva el mismo Message-ID;
    · autenticación o remitente rechazados: son de nuestra configuración, no
      del mensaje, y se arreglan sin tocarlo.
    """
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        codigos = [codigo for codigo, _ in error.recipients.values()]
        detalle = "; ".join(f"{codigo} {_texto(texto)}" for codigo, texto in error.recipients.values())
        permanente = bool(codigos) and all(500 <= codigo < 600 for codigo in codigos)
        return ErrorDeEnvio(f"smtp_{max(codigos) if codigos else 'rcpt'}", detalle, permanente=permanente)
    if isinstance(error, smtplib.SMTPDataError):
        return ErrorDeEnvio(
            f"smtp_{error.smtp_code}", _texto(error.smtp_error),
            permanente=500 <= error.smtp_code < 600,
        )
    if isinstance(error, smtplib.SMTPResponseException):
        # Remitente, autenticación, saludo o conexión rechazados.
        return ErrorDeEnvio(f"smtp_{error.smtp_code}", _texto(error.smtp_error), permanente=False)
    if isinstance(error, TimeoutError):
        return ErrorDeEnvio("tiempo_agotado", type(error).__name__, permanente=False)
    if isinstance(error, (smtplib.SMTPException, OSError)):
        return ErrorDeEnvio("conexion", f"{type(error).__name__}: {error}", permanente=False)
    raise TypeError(f"no es un error de envío: {type(error).__name__}")


class CanalCorreo:
    nombre = "email"

    def destino(self, organizacion_id, usuario_id) -> str | None:
        """La dirección de la persona, o None si no se conoce."""
        direccion = (
            DireccionCorreo.objects.filter(organizacion_id=organizacion_id, usuario_id=usuario_id)
            .values_list("email", flat=True)
            .first()
        )
        if direccion is None:
            return None
        try:
            validate_email(direccion)
        except ValidationError:
            # Sin el valor: el detalle queda en la fila y en el log no va.
            raise ErrorDeEnvio("direccion_invalida", "la dirección guardada no es un correo", permanente=True) from None
        return direccion

    def message_id(self, entrega_id) -> str:
        """Determinístico: el mismo en cada intento de la misma entrega.

        El dominio sale de la DIRECCIÓN del remitente: `DEFAULT_FROM_EMAIL`
        puede traer nombre visible («Ojo al Gasto <no-responder@…>»), y
        cortar el texto entero en la arroba dejaba el «>» pegado al dominio.
        """
        _, direccion = parseaddr(settings.DEFAULT_FROM_EMAIL)
        dominio = direccion.rpartition("@")[2] or "ojoalgasto.local"
        return f"<alerta-{entrega_id}@{dominio}>"

    def _mensaje(self, envio: Envio) -> EmailMessage:
        return EmailMessage(
            subject=envio.asunto,
            body=envio.cuerpo,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[envio.destino],
            headers={"Message-ID": envio.message_id},
        )

    def validar(self, envio: Envio) -> None:
        """Arma el mensaje sin mandarlo. Lanza `ErrorDeEnvio` si no se puede.

        Un encabezado con salto de línea (`BadHeaderError`) falla igual en
        cada intento, sin llegar a hablar con el servidor: es permanente, y
        se descubre ANTES de reclamar, para que no gaste un intento ni abra
        la conexión SMTP cinco veces para nada.
        """
        try:
            self._mensaje(envio).message()
        except BadHeaderError:
            raise ErrorDeEnvio(
                "mensaje_invalido", "un encabezado del correo trae un salto de línea", permanente=True,
            ) from None

    def enviar(self, envio: Envio) -> dict:
        """Manda el correo. Devuelve la evidencia o lanza `ErrorDeEnvio`."""
        try:
            aceptados = self._mensaje(envio).send(fail_silently=False)
        except BadHeaderError:
            # `validar` ya lo descarta; si llega acá, mismo diagnóstico.
            raise ErrorDeEnvio(
                "mensaje_invalido", "un encabezado del correo trae un salto de línea", permanente=True,
            ) from None
        except (smtplib.SMTPException, OSError) as error:
            raise clasificar_smtp(error) from None
        if aceptados != 1:
            # Con SMTP no pasa sin excepción; si un backend lo hace, no hay
            # aceptación que anotar.
            raise ErrorDeEnvio("sin_confirmacion", f"el backend informó {aceptados} aceptados", permanente=False)
        return {
            "message_id": envio.message_id,
            # Deja a la vista con qué se mandó. Fuera de las pruebas solo puede
            # ser uno de EMAIL_BACKENDS_CON_PROVEEDOR (`exigir_proveedor`); en
            # ellas dice `locmem`, que es un buzón en memoria.
            "backend": settings.EMAIL_BACKEND,
        }


#: Los canales que de verdad pueden entregar. El push no está (ver arriba).
CANALES = {
    CanalCorreo.nombre: CanalCorreo(),
}


def disponible(canal: str) -> bool:
    """Tiene con qué mandarse y la configuración lo habilita."""
    return canal in CANALES and canal in settings.CANALES_HABILITADOS


#: El buzón en memoria que pone pytest-django. Solo cuenta como proveedor en
#: las pruebas, que lo agregan a `EMAIL_BACKENDS_CON_PROVEEDOR`.
BACKEND_DE_PRUEBAS = "django.core.mail.backends.locmem.EmailBackend"


def exigir_proveedor(canal: str) -> None:
    """Se niega a mandar un correo con un backend que no entrega a nadie.

    Con dummy, console o filebased, `send()` devuelve 1 y no sale nada: la
    entrega quedaría «aceptada por el proveedor», contaría para la cuota y
    no se reintentaría nunca. Es un error de configuración, no de la
    entrega, así que no se anota en la fila: se lanza ANTES de tocarla, la
    entrega queda como estaba y sale cuando se corrija el backend.
    """
    if canal != CanalCorreo.nombre:
        return
    if settings.EMAIL_BACKEND not in settings.EMAIL_BACKENDS_CON_PROVEEDOR:
        raise ImproperlyConfigured(
            f"EMAIL_BACKEND={settings.EMAIL_BACKEND} no entrega a ningún proveedor "
            "(ver EMAIL_BACKENDS_CON_PROVEEDOR): no se despacha"
        )

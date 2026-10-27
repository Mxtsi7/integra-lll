"""Lo que cada proveedor de correo necesita para el OAuth (FE-03 / FE-04 / FE-05).

Acá vive TODO lo que es específico de Google o de Microsoft: las tres URL
(autorizar, canjear, revocar) y los scopes. El resto del servicio no sabe de
proveedores, solo le pide a este módulo.

── Por qué los scopes son de solo lectura ───────────────────────────────────
El sistema lee correos para encontrar cobros. No manda, no borra, no archiva.
Pedir más de lo que se usa es regalarle al usuario un riesgo que no compramos
con nada, y es lo primero que mira cualquiera al leer la pantalla de consentimiento.

    gmail    → gmail.readonly   (leer, nada más)
    outlook  → Mail.Read        (leer, nada más)

`offline_access` / `access_type=offline` sí van: sin refresh token habría que
pedirle al usuario que vuelva a autorizar cada hora.

── Por qué el canje y la revocación están acá y no en la vista ──────────────
Para poder reemplazarlos en las pruebas por un doble sin levantar un servidor
ni hablar con Google. Las vistas llaman `canjear_codigo` y `revocar`; las
pruebas parchean esas dos funciones. Lo que se prueba es nuestra lógica —
state, un solo uso, aislamiento entre organizaciones—, no la librería de HTTP.
"""

from __future__ import annotations

import base64
import dataclasses
import json
from urllib.parse import urlencode

import requests
from django.conf import settings

from .models import CuentaConectada


# Cuánto esperamos a un proveedor antes de rendirnos. Sin timeout, `requests`
# espera para siempre: un proveedor lento dejaría el worker tomado y el
# gateway cortaría la petición mucho antes, sin liberar nada de este lado.
TIEMPO_LIMITE = 10


class ProveedorNoSoportado(Exception):
    """El proveedor no hace OAuth (el CSV, por ejemplo) o no existe."""


class ErrorDelProveedor(Exception):
    """El proveedor respondió algo que no sirve. El detalle NO lleva el token."""


@dataclasses.dataclass(frozen=True)
class ConfiguracionOAuth:
    """Los datos fijos de un proveedor. Las credenciales salen de settings."""

    url_autorizacion: str
    url_canje: str
    url_revocacion: str
    scopes: tuple[str, ...]
    # Google quiere access_type=offline + prompt=consent para entregar el
    # refresh token; Microsoft lo entrega con el scope offline_access.
    extra_autorizacion: tuple[tuple[str, str], ...] = ()

    @property
    def scope_junto(self) -> str:
        return " ".join(self.scopes)


CONFIGURACIONES: dict[str, ConfiguracionOAuth] = {
    CuentaConectada.Proveedor.GMAIL: ConfiguracionOAuth(
        url_autorizacion="https://accounts.google.com/o/oauth2/v2/auth",
        url_canje="https://oauth2.googleapis.com/token",
        url_revocacion="https://oauth2.googleapis.com/revoke",
        scopes=(
            "https://www.googleapis.com/auth/gmail.readonly",
            "openid",
            "email",
        ),
        extra_autorizacion=(
            ("access_type", "offline"),
            # Sin esto Google solo manda el refresh token la PRIMERA vez que
            # el usuario autoriza. Si reconecta, llega sin él y la cuenta
            # queda sin poder refrescarse.
            ("prompt", "consent"),
        ),
    ),
    CuentaConectada.Proveedor.OUTLOOK: ConfiguracionOAuth(
        url_autorizacion="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        url_canje="https://login.microsoftonline.com/common/oauth2/v2.0/token",
        # Microsoft no publica un endpoint de revocación por token: se revoca
        # desde la cuenta del usuario. Ver `revocar()`.
        url_revocacion="",
        scopes=(
            "https://graph.microsoft.com/Mail.Read",
            "offline_access",
            "openid",
            "email",
        ),
    ),
}


def configuracion_de(proveedor: str) -> ConfiguracionOAuth:
    """La configuración del proveedor, o `ProveedorNoSoportado`.

    El CSV es un proveedor válido del modelo (una organización carga cartolas
    a mano) pero no tiene OAuth: no hay a quién pedirle permiso.
    """
    try:
        return CONFIGURACIONES[proveedor]
    except KeyError:
        raise ProveedorNoSoportado(
            f"{proveedor} no usa OAuth; no se puede iniciar una autorización."
        ) from None


def credenciales_de(proveedor: str) -> tuple[str, str]:
    """(client_id, client_secret) desde settings. Vacíos si no están puestos."""
    claves = settings.OAUTH_CREDENCIALES.get(proveedor, {})
    return claves.get("client_id", ""), claves.get("client_secret", "")


def url_de_autorizacion(
    proveedor: str, *, estado_oauth: str, desafio_pkce: str, redirect_uri: str
) -> str:
    """Arma la URL a la que mandamos al usuario a dar el consentimiento.

    No hace HTTP: solo construye el enlace. El usuario es quien lo visita.
    """
    config = configuracion_de(proveedor)
    client_id, _ = credenciales_de(proveedor)
    parametros = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": config.scope_junto,
        "state": estado_oauth,
        # PKCE (RFC 7636). Va el DESAFÍO, nunca el verificador: el verificador
        # se queda de este lado y viaja recién en el canje, que es lo que
        # prueba que quien canjea es quien inició.
        "code_challenge": desafio_pkce,
        "code_challenge_method": "S256",
        **dict(config.extra_autorizacion),
    }
    return f"{config.url_autorizacion}?{urlencode(parametros)}"


def canjear_codigo(
    proveedor: str, *, codigo: str, verificador_pkce: str, redirect_uri: str
) -> dict:
    """Cambia el código de un solo uso por los tokens.

    Devuelve un dict con access_token, refresh_token, expires_in y la cuenta
    (email) que autorizó. Lanza `ErrorDelProveedor` si la respuesta no sirve.
    """
    config = configuracion_de(proveedor)
    client_id, client_secret = credenciales_de(proveedor)
    try:
        respuesta = requests.post(
            config.url_canje,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": codigo,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "code_verifier": verificador_pkce,
            },
            timeout=TIEMPO_LIMITE,
        )
    except requests.RequestException as exc:
        # El mensaje de la excepción puede traer la URL con parámetros; se
        # reemplaza por uno nuestro para no filtrar nada al log.
        raise ErrorDelProveedor(
            f"No se pudo contactar a {proveedor} para canjear el código."
        ) from exc

    if respuesta.status_code != 200:
        # El cuerpo de error de OAuth trae `error` y `error_description`, que
        # son seguros; el token nunca viene en una respuesta de error. Aun
        # así solo se pasa el código `error`, que es un enum corto.
        codigo_error = ""
        try:
            codigo_error = str(respuesta.json().get("error", ""))[:60]
        except ValueError:
            pass
        raise ErrorDelProveedor(
            f"{proveedor} rechazó el canje del código ({codigo_error or respuesta.status_code})."
        )

    try:
        datos = respuesta.json()
    except ValueError as exc:
        raise ErrorDelProveedor(f"{proveedor} respondió algo que no es JSON.") from exc

    if not datos.get("access_token"):
        raise ErrorDelProveedor(f"{proveedor} no devolvió token de acceso.")
    return datos


def revocar(proveedor: str, *, access_token: str) -> bool:
    """Pide al proveedor que invalide el token. True si lo confirmó.

    ── Por qué devuelve bool y no lanza ─────────────────────────────────────
    Desconectar tiene que funcionar aunque el proveedor no conteste. Lo que el
    usuario pidió es dejar de darnos acceso, y de eso nos encargamos nosotros
    borrando las credenciales. Si además el proveedor confirma, mejor; si no,
    queda anotado en `detalle_del_estado` y la cuenta igual queda desconectada.
    Tumbar el DELETE porque Google no responde dejaría la cuenta conectada,
    que es exactamente lo contrario de lo que se pidió.

    Microsoft no tiene endpoint de revocación por token: devuelve False y el
    detalle lo explica. El token igual queda inservible de este lado porque se
    borra, y expira solo.
    """
    config = configuracion_de(proveedor)
    if not config.url_revocacion:
        return False
    try:
        respuesta = requests.post(
            config.url_revocacion,
            data={"token": access_token},
            timeout=TIEMPO_LIMITE,
        )
    except requests.RequestException:
        return False
    return respuesta.status_code in (200, 204)


def correo_autorizado(proveedor: str, respuesta_del_canje: dict) -> str:
    """Qué cuenta autorizó, sacado de la respuesta del canje.

    Primero mira un campo `email` suelto (algunos proveedores lo mandan así);
    si no, lee el `id_token`, que viene porque pedimos los scopes `openid` y
    `email`.

    ── Sobre leer el id_token sin verificar la firma ────────────────────────
    Se decodifica el payload y se confía en él. No es un descuido: el token
    llegó como respuesta DIRECTA del endpoint de canje del proveedor, por una
    conexión TLS que nosotros iniciamos contra su dominio. Lo que la firma
    probaría —que lo emitió el proveedor— ya lo prueba el canal. Google lo
    dice explícitamente en su documentación para este caso.

    Donde la firma SÍ es obligatoria es cuando el id_token llega por otro
    lado: desde el navegador, desde el cliente, desde cualquier sitio que no
    sea esta misma llamada. Si alguna vez se recibe un id_token así, hay que
    verificarlo con las claves públicas del proveedor. **No reutilizar esta
    función para eso.**
    """
    correo = respuesta_del_canje.get("email")
    if correo:
        return str(correo).strip().lower()

    id_token = respuesta_del_canje.get("id_token")
    if not id_token:
        return ""
    try:
        payload = id_token.split(".")[1]
        # base64url sin relleno: hay que devolvérselo antes de decodificar.
        payload += "=" * (-len(payload) % 4)
        datos = json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError, TypeError):
        return ""
    return str(datos.get("email", "")).strip().lower()

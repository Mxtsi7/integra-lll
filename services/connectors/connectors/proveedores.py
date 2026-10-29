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
import time
from urllib.parse import urlencode

import requests
from django.conf import settings

from .models import CuentaConectada


# Cuánto esperamos a un proveedor antes de rendirnos. Sin timeout, `requests`
# espera para siempre: un proveedor lento dejaría el worker tomado y el
# gateway cortaría la petición mucho antes, sin liberar nada de este lado.
TIEMPO_LIMITE = 10

# Tolerancia de reloj al comprobar `exp` del id_token. Chica a proposito:
# un margen grande vuelve a aceptar tokens vencidos.
MARGEN_RELOJ = 60


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
    #: Los `iss` que aceptamos en el id_token de este proveedor. Google
    #: emite con y sin esquema segun el flujo, y los dos son validos.
    emisores: tuple[str, ...] = ()
    # Google quiere access_type=offline + prompt=consent para entregar el
    # refresh token; Microsoft lo entrega con el scope offline_access.
    extra_autorizacion: tuple[tuple[str, str], ...] = ()
    #: ¿El proveedor ofrece una operación de revocación que podamos usar?
    #: No se deduce de `url_revocacion`: un fallo del proveedor y una
    #: limitación permanente son cosas distintas. Outlook es el caso conocido
    #: en que no existe revocación por token; su política se documenta en
    #: `docs/decisiones/mx-07-outlook-revocacion.md`.
    revocacion_soportada: bool = True

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
        emisores=("https://accounts.google.com", "accounts.google.com"),
        extra_autorizacion=(
            ("access_type", "offline"),
            # Sin esto Google solo manda el refresh token la PRIMERA vez que
            # el usuario autoriza. Si reconecta, llega sin él y la cuenta
            # queda sin poder refrescarse.
            ("prompt", "consent"),
        ),
        revocacion_soportada=True,
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
        # Microsoft emite por tenant: https://login.microsoftonline.com/{tid}/v2.0
        # El prefijo se comprueba aparte, en `_emisor_aceptado`.
        emisores=("https://login.microsoftonline.com/",),
        # Limitación permanente del proveedor, no un fallo reintentable.
        revocacion_soportada=False,
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


def soporta_revocacion(proveedor: str) -> bool:
    """¿El proveedor ofrece una revocación que podamos intentar?

    Un proveedor desconocido se trata como **soportado** para que la limpieza
    lo bloquee en vez de aceptarlo por error. El CSV tampoco está en
    `CONFIGURACIONES`, pero la limpieza lo excluye antes de llegar acá.
    """
    config = CONFIGURACIONES.get(proveedor)
    return True if config is None else config.revocacion_soportada


def proveedores_sin_revocacion() -> tuple[str, ...]:
    """Proveedores cuya limitación es permanente, no un fallo reintentable."""
    return tuple(
        proveedor
        for proveedor, config in CONFIGURACIONES.items()
        if not config.revocacion_soportada
    )


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

    Este `False` no distingue “el proveedor no lo soporta” de “el proveedor
    falló”. Para esa decisión, usar `soporta_revocacion()`; la limpieza de
    Outlook no debe confundir la limitación permanente con un fallo
    reintentable.
    """
    config = configuracion_de(proveedor)
    if not config.revocacion_soportada or not config.url_revocacion:
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


def _emisor_aceptado(config: ConfiguracionOAuth, iss: str) -> bool:
    """¿El `iss` del token es uno de los de este proveedor?

    Microsoft emite por tenant (`.../{tenant}/v2.0`), así que para los
    emisores que terminan en `/` se acepta por prefijo. Google emite un valor
    fijo y se compara completo.
    """
    for esperado in config.emisores:
        if esperado.endswith("/"):
            if iss.startswith(esperado):
                return True
        elif iss == esperado:
            return True
    return False


def correo_autorizado(proveedor: str, respuesta_del_canje: dict) -> str:
    """Qué cuenta autorizó, según el `id_token` de la respuesta del canje.

    ── Qué se valida y qué no ───────────────────────────────────────────────
    Se validan **`iss`, `aud` y `exp`**, que es lo que pide
    OIDC Core §3.1.3.7, y además que haya `email`.

    La **firma** no se verifica, y eso sí es una excepción deliberada: el
    token llegó como respuesta DIRECTA del endpoint de canje del proveedor,
    por una conexión TLS que nosotros iniciamos contra su dominio. Lo que la
    firma probaría —que lo emitió el proveedor— ya lo prueba el canal, y
    Google lo documenta explícitamente para este caso.

    **Pero la excepción de la firma no cubre el resto.** Saltarse `iss`, `aud`
    y `exp` dejaba pasar un token con emisor ajeno, audiencia de otro cliente
    y vencido en 1970: lo reprodujo la revisión de la PR y era cierto. Que el
    canal autentique al emisor no dice nada sobre *para quién* se emitió el
    token ni sobre si sigue vigente.

    Donde la firma SÍ es obligatoria es cuando el id_token llega por otro
    lado: desde el navegador, desde el cliente, desde cualquier sitio que no
    sea esta misma llamada. **No reutilizar esta función para eso.**

    ── Por qué ya no se acepta un campo `email` suelto ──────────────────────
    Antes, si la respuesta traía `email` fuera del token, se usaba sin más.
    Un campo suelto no es una identidad verificada: no tiene emisor ni
    audiencia ni vencimiento. Ahora solo se usa como *complemento* cuando el
    id_token es válido pero no trae `email`.
    """
    config = configuracion_de(proveedor)
    client_id, _ = credenciales_de(proveedor)

    id_token = respuesta_del_canje.get("id_token")
    if not id_token:
        raise ErrorDelProveedor(
            f"{proveedor} no devolvió id_token: no hay identidad que verificar."
        )

    try:
        payload = id_token.split(".")[1]
        # base64url sin relleno: hay que devolvérselo antes de decodificar.
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError, TypeError) as exc:
        raise ErrorDelProveedor(f"el id_token de {proveedor} no se pudo leer.") from exc

    if not isinstance(claims, dict):
        raise ErrorDelProveedor(f"el id_token de {proveedor} no trae un objeto.")

    iss = str(claims.get("iss", ""))
    if not _emisor_aceptado(config, iss):
        raise ErrorDelProveedor(
            f"el id_token no lo emitió {proveedor} (iss={iss[:60]!r})."
        )

    # `aud` puede venir como texto o como lista (OIDC lo permite).
    crudo_aud = claims.get("aud")
    audiencias = crudo_aud if isinstance(crudo_aud, list) else [crudo_aud]
    if not client_id or client_id not in [str(a) for a in audiencias]:
        raise ErrorDelProveedor(
            "el id_token no fue emitido para esta aplicación."
        )

    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or isinstance(exp, bool):
        raise ErrorDelProveedor("el id_token no dice cuándo vence.")
    # MARGEN segundos de tolerancia por relojes desfasados, no más: un margen
    # grande vuelve a aceptar tokens vencidos.
    if exp + MARGEN_RELOJ < time.time():
        raise ErrorDelProveedor("el id_token está vencido.")

    correo = claims.get("email") or respuesta_del_canje.get("email")
    if not correo:
        raise ErrorDelProveedor(
            f"{proveedor} no dijo qué cuenta se autorizó (sin `email`)."
        )
    return str(correo).strip().lower()

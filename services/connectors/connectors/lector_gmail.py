"""S3-FE-02 — consultar los mensajes de una cuenta de Gmail autorizada.

Es la primera pieza de la lectura de correo. Este módulo **lee y nada más**:
devuelve los mensajes de una página, en memoria, y no guarda nada. Lo que
viene después tiene su propia tarjeta:

    S3-FE-03  guardar hasta dónde se leyó (el cursor por cuenta)
    S3-FE-06  sacar el servicio y el identificador de cada mensaje
    S3-FE-07  sacar importe, moneda y fecha
    S3-FE-18  reintentar con espera progresiva los errores transitorios
    S3-FE-19  renovar el token vencido o pedir reconexión
    S3-FE-20  dejar de leer una cuenta que se desconecta a mitad de camino

Por eso los errores salen como excepciones con un `codigo` estable y no como
cambios de estado: quien llame decide si reintenta (FE-18) o si pide
reconexión (FE-19). Este módulo no marca la cuenta.

── Solo cuentas autorizadas ────────────────────────────────────────────────
La cuenta se busca **por organización**: una cuenta de otra organización da
el mismo error que una que no existe, para no confirmar que existe. Además
tiene que ser de Gmail, estar `conectada`, tener un token que descifre con
las claves vigentes y que no esté vencido. Si falta cualquiera de esas cosas
no se habla con Google.

── Acceso mínimo ───────────────────────────────────────────────────────────
El permiso que se pide al conectar ya es `gmail.readonly` (FE-03 del sprint
2). Acá se limita además lo que se trae: la búsqueda filtra los correos que
pueden ser cobros, se pide a Google solo los campos que se usan (`fields`) y
de cada mensaje se conserva el texto, sin adjuntos y con un tope de largo.

── Límites ─────────────────────────────────────────────────────────────────
Una llamada lee **una página** de hasta `LIMITE_MAXIMO` mensajes y devuelve
el `siguiente_pagina` para pedir la próxima. No recorre el buzón entero de una
vez: eso dejaría un worker tomado por minutos y, si se cae, sin saber hasta
dónde llegó. Recorrer y recordar es S3-FE-03.
"""

from __future__ import annotations

import base64
import dataclasses
import re
import uuid
from datetime import datetime, timedelta, timezone as tz
from email.header import decode_header, make_header
from html.parser import HTMLParser

import requests
from django.core.exceptions import ValidationError
from django.utils import timezone

from shared.cifrado import SECRETO_ILEGIBLE

from .models import CuentaConectada
from .proveedores import TIEMPO_LIMITE

URL_MENSAJES = "https://gmail.googleapis.com/gmail/v1/users/me/messages"

#: Cuántos mensajes trae una llamada si no se dice otra cosa, y el máximo.
#: Google acepta hasta 500 por página en la lista, pero cada mensaje es una
#: llamada más para traer su contenido: 100 ya son 101 peticiones.
LIMITE_POR_DEFECTO = 25
LIMITE_MAXIMO = 100

#: Tope del texto que se conserva de cada mensaje. Un recibo cabe de sobra;
#: un boletín con todo su HTML, no, y no hace falta.
LARGO_MAXIMO_TEXTO = 20_000

#: Un `pageToken` de Gmail es una cadena corta. Uno de este largo no lo
#: emitió Google y no se reenvía.
LARGO_MAXIMO_PAGINA = 512

#: Un token que vence en menos de esto ya no alcanza para leer una página.
MARGEN_VENCIMIENTO = timedelta(seconds=30)

#: Lo que busca la consulta por omisión. Gmail interpreta `{a b}` como
#: "a o b". Va en español y en inglés porque los recibos de servicios
#: extranjeros llegan en inglés. Es un filtro amplio a propósito: un recibo
#: que no entra aquí no se ve nunca, uno que sobra lo descarta S3-FE-08.
PALABRAS_DE_COBRO = (
    "recibo", "factura", "boleta", "pago", "cobro", "suscripción",
    "suscripcion", "renovación", "renovacion", "cargo",
    "receipt", "invoice", "payment", "subscription", "renewal", "billing",
)

#: Cómo se reconoce un remitente aceptable para el filtro: una dirección o un
#: dominio. Cualquier otra cosa podría cambiar el sentido de la búsqueda
#: (`a) OR in:anywhere`, o un `-` adelante, que en Gmail niega), así que se
#: rechaza antes de armarla.
_REMITENTE = re.compile(
    r"^[A-Za-z0-9._%+][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$"
    r"|^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$"
)

#: Lo que se le pide a Google. Partial response: lo demás no viaja.
_CAMPOS_LISTA = "messages(id,threadId),nextPageToken"
_CAMPOS_MENSAJE = "id,threadId,internalDate,payload"

#: Profundidad y cantidad de partes MIME que se recorren. Un correo legítimo
#: no pasa de unas pocas; el tope evita que uno armado a propósito haga
#: recorrer miles.
_PROFUNDIDAD_MAXIMA = 10
_PARTES_MAXIMAS = 100

#: Motivos de 403 que en Gmail significan "más despacio", no "no puedes".
_RAZONES_DE_CUOTA = {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}


# ── errores ─────────────────────────────────────────────────────────────────


class ErrorDeLectura(Exception):
    """Base de lo que puede salir mal al leer. `codigo` es estable; el
    mensaje es para una persona y nunca lleva el token."""

    codigo = "error_de_lectura"

    def __init__(self, mensaje: str, *, codigo: str | None = None):
        super().__init__(mensaje)
        if codigo is not None:
            self.codigo = codigo


class CuentaNoDisponible(ErrorDeLectura):
    """No se habló con Google: la cuenta no se puede leer tal como está."""

    NO_ENCONTRADA = "cuenta_no_encontrada"
    DESCONECTADA = "cuenta_desconectada"
    REQUIERE_REAUTORIZACION = "requiere_reautorizacion"
    SIN_CREDENCIALES = "sin_credenciales"
    CREDENCIAL_VENCIDA = "credencial_vencida"
    ESTADO_NO_LEGIBLE = "estado_no_legible"


class AutorizacionRechazada(ErrorDeLectura):
    """Google dijo que el token ya no sirve o no alcanza (401, o 403 de
    permisos). Lo resuelve S3-FE-19: renovar o pedir reconexión."""

    codigo = "autorizacion_rechazada"


class ErrorTransitorio(ErrorDeLectura):
    """Red, tiempo agotado, cuota o una falla de Google. Se puede reintentar
    más tarde (S3-FE-18) sin perder nada: no se guardó nada."""

    codigo = "error_transitorio"


class ErrorDelProveedor(ErrorDeLectura):
    """Google contestó algo que reintentar no arregla: una página inválida,
    la API sin habilitar en el proyecto, una respuesta que no se entiende."""

    codigo = "error_del_proveedor"


# ── lo que se pide y lo que se devuelve ─────────────────────────────────────


@dataclasses.dataclass(frozen=True)
class FiltroCorreos:
    """Qué correos interesan. Todo opcional; por omisión, los que parecen
    cobros, de cualquier fecha y remitente.

    `desde` y `hasta` van a Gmail en segundos epoch, que es la forma en que
    Gmail no depende de la zona horaria de la cuenta. `hasta` es exclusivo.
    """

    desde: datetime | None = None
    hasta: datetime | None = None
    remitentes: tuple[str, ...] = ()
    solo_cobros: bool = True

    def consulta(self) -> str:
        """El parámetro `q` de Gmail. Valida antes de armar."""
        partes: list[str] = []
        for nombre, valor in (("desde", self.desde), ("hasta", self.hasta)):
            if valor is not None and timezone.is_naive(valor):
                raise ValueError(f"`{nombre}` tiene que traer zona horaria.")
        if self.desde and self.hasta and self.desde >= self.hasta:
            raise ValueError("`desde` tiene que ser anterior a `hasta`.")
        if self.desde:
            partes.append(f"after:{int(self.desde.timestamp())}")
        if self.hasta:
            partes.append(f"before:{int(self.hasta.timestamp())}")
        if self.remitentes:
            for remitente in self.remitentes:
                if not isinstance(remitente, str) or not _REMITENTE.match(remitente):
                    raise ValueError(f"remitente no válido para el filtro: {remitente!r:.60}")
            partes.append("from:(" + " OR ".join(self.remitentes) + ")")
        if self.solo_cobros:
            partes.append("{" + " ".join(PALABRAS_DE_COBRO) + "}")
        return " ".join(partes)


@dataclasses.dataclass(frozen=True)
class MensajeCorreo:
    """Un mensaje leído. Vive en memoria: este módulo no lo guarda."""

    cuenta_id: uuid.UUID
    id_mensaje: str
    id_hilo: str
    recibido_en: datetime
    remitente: str
    asunto: str
    #: Fuera del `repr` para que un log o una traza no se lleven el correo.
    texto: str = dataclasses.field(repr=False)
    #: True si el texto se cortó en `LARGO_MAXIMO_TEXTO`.
    texto_truncado: bool = False


@dataclasses.dataclass(frozen=True)
class MensajeOmitido:
    """Un mensaje que la lista nombró pero no se pudo traer. Se informa en
    vez de callarlo: perderlo en silencio es perder un cobro."""

    id_mensaje: str
    motivo: str


@dataclasses.dataclass(frozen=True)
class PaginaDeMensajes:
    mensajes: tuple[MensajeCorreo, ...]
    #: Para pedir la página siguiente; `None` si no hay más.
    siguiente_pagina: str | None
    omitidos: tuple[MensajeOmitido, ...] = ()


# ── la cuenta ───────────────────────────────────────────────────────────────


def cuenta_para_leer(*, organizacion_id, cuenta_id) -> tuple[CuentaConectada, str]:
    """La cuenta de Gmail de ESA organización y su token, o `CuentaNoDisponible`.

    Devuelve el token aparte para que no haya que volver a descifrarlo, y
    para que nadie tenga que leer `cuenta.access_token` fuera de aquí.
    """
    try:
        cuenta = CuentaConectada.objects.filter(
            pk=cuenta_id,
            organizacion_id=organizacion_id,
            proveedor=CuentaConectada.Proveedor.GMAIL,
        ).first()
    except (ValidationError, ValueError, TypeError):
        # Un identificador que ni siquiera es un UUID tampoco es una cuenta.
        cuenta = None
    if cuenta is None:
        # Ajena, de otro proveedor o inexistente: la misma respuesta.
        raise CuentaNoDisponible(
            "No hay una cuenta de Gmail con ese identificador en esta organización.",
            codigo=CuentaNoDisponible.NO_ENCONTRADA,
        )
    if cuenta.estado == CuentaConectada.Estado.DESCONECTADA:
        raise CuentaNoDisponible(
            "La cuenta está desconectada.", codigo=CuentaNoDisponible.DESCONECTADA,
        )
    if cuenta.necesita_reautorizacion:
        raise CuentaNoDisponible(
            "La cuenta necesita que el usuario vuelva a autorizarla.",
            codigo=CuentaNoDisponible.REQUIERE_REAUTORIZACION,
        )
    if cuenta.estado != CuentaConectada.Estado.CONECTADA:
        # Un estado que no conocemos no se lee "por si acaso".
        raise CuentaNoDisponible(
            f"La cuenta está en un estado que no permite leer ({cuenta.estado[:30]}).",
            codigo=CuentaNoDisponible.ESTADO_NO_LEGIBLE,
        )
    token = cuenta.access_token
    if not token or token is SECRETO_ILEGIBLE:
        raise CuentaNoDisponible(
            "La cuenta no tiene credenciales guardadas.",
            codigo=CuentaNoDisponible.SIN_CREDENCIALES,
        )
    if cuenta.token_expira_en and cuenta.token_expira_en <= timezone.now() + MARGEN_VENCIMIENTO:
        raise CuentaNoDisponible(
            "El token de acceso venció; hay que renovarlo antes de leer (S3-FE-19).",
            codigo=CuentaNoDisponible.CREDENCIAL_VENCIDA,
        )
    return cuenta, str(token)


# ── leer ────────────────────────────────────────────────────────────────────


def leer_mensajes(
    *,
    organizacion_id,
    cuenta_id,
    filtro: FiltroCorreos | None = None,
    pagina: str | None = None,
    limite: int = LIMITE_POR_DEFECTO,
) -> PaginaDeMensajes:
    """Una página de mensajes de la cuenta, con su contenido.

    Valida todo lo que se le pasa ANTES de hablar con Google: un límite fuera
    de rango, una página que no puede venir de Gmail o un filtro mal armado
    no gastan una llamada.
    """
    if isinstance(limite, bool) or not isinstance(limite, int) or not 1 <= limite <= LIMITE_MAXIMO:
        raise ValueError(f"`limite` va de 1 a {LIMITE_MAXIMO}.")
    if pagina is not None and (not isinstance(pagina, str) or not pagina or len(pagina) > LARGO_MAXIMO_PAGINA):
        raise ValueError("`pagina` no es un token de página de Gmail.")
    consulta = (filtro or FiltroCorreos()).consulta()

    cuenta, token = cuenta_para_leer(organizacion_id=organizacion_id, cuenta_id=cuenta_id)

    parametros = {"maxResults": limite, "fields": _CAMPOS_LISTA}
    if consulta:
        parametros["q"] = consulta
    if pagina:
        parametros["pageToken"] = pagina
    lista = _pedir(URL_MENSAJES, token, parametros)

    referencias = lista.get("messages") or []
    if not isinstance(referencias, list):
        raise ErrorDelProveedor("Gmail devolvió una lista de mensajes que no es una lista.")

    mensajes: list[MensajeCorreo] = []
    omitidos: list[MensajeOmitido] = []
    for referencia in referencias[:limite]:
        id_mensaje = referencia.get("id") if isinstance(referencia, dict) else None
        if not isinstance(id_mensaje, str) or not re.fullmatch(r"[0-9A-Za-z_-]{1,64}", id_mensaje):
            omitidos.append(MensajeOmitido(str(id_mensaje)[:64], "identificador no válido"))
            continue
        try:
            crudo = _pedir(f"{URL_MENSAJES}/{id_mensaje}", token, {"format": "full", "fields": _CAMPOS_MENSAJE})
        except _MensajeYaNoExiste:
            # Se borró entre la lista y la lectura. Se informa y se sigue.
            omitidos.append(MensajeOmitido(id_mensaje, "el mensaje ya no existe"))
            continue
        if crudo.get("id") != id_mensaje:
            omitidos.append(MensajeOmitido(id_mensaje, "Gmail devolvió otro mensaje"))
            continue
        try:
            mensajes.append(_mensaje(cuenta.pk, crudo))
        except ValueError as exc:
            omitidos.append(MensajeOmitido(id_mensaje, str(exc)[:120]))

    siguiente = lista.get("nextPageToken")
    if siguiente is not None and (not isinstance(siguiente, str) or len(siguiente) > LARGO_MAXIMO_PAGINA):
        raise ErrorDelProveedor("Gmail devolvió un token de página que no se entiende.")
    return PaginaDeMensajes(tuple(mensajes), siguiente or None, tuple(omitidos))


class _MensajeYaNoExiste(Exception):
    """404 al pedir un mensaje: no es un error de la lectura completa."""


def _pedir(url: str, token: str, parametros: dict) -> dict:
    """Un GET a Gmail con el token. Traduce cada respuesta a un resultado o
    a una de las excepciones de arriba. Ningún mensaje lleva el token ni la
    URL completa (que puede traer la consulta)."""
    try:
        respuesta = requests.get(
            url,
            params=parametros,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=TIEMPO_LIMITE,
        )
    except requests.Timeout:
        raise ErrorTransitorio("Gmail no contestó a tiempo.", codigo="tiempo_agotado") from None
    except requests.RequestException:
        raise ErrorTransitorio("No se pudo contactar a Gmail.", codigo="sin_conexion") from None

    estado = respuesta.status_code
    if estado == 200:
        try:
            cuerpo = respuesta.json()
        except ValueError:
            raise ErrorDelProveedor("Gmail respondió algo que no es JSON.") from None
        if not isinstance(cuerpo, dict):
            raise ErrorDelProveedor("Gmail respondió un JSON que no es un objeto.")
        return cuerpo

    razon, estado_google = _motivo_del_error(respuesta)
    if estado == 401:
        raise AutorizacionRechazada("Gmail rechazó el token de acceso (401).")
    if estado == 403:
        if razon in _RAZONES_DE_CUOTA:
            raise ErrorTransitorio("Gmail pidió bajar el ritmo (cuota).", codigo="cuota_excedida")
        if razon == "accessNotConfigured" or estado_google == "SERVICE_DISABLED":
            raise ErrorDelProveedor(
                "La API de Gmail no está habilitada en el proyecto de Google Cloud.",
                codigo="api_deshabilitada",
            )
        raise AutorizacionRechazada(
            f"Gmail negó el acceso (403{', ' + razon if razon else ''}).",
            codigo="permiso_insuficiente",
        )
    if estado == 404 and url != URL_MENSAJES:
        raise _MensajeYaNoExiste()
    if estado == 429:
        raise ErrorTransitorio("Gmail pidió bajar el ritmo (429).", codigo="cuota_excedida")
    if estado >= 500:
        raise ErrorTransitorio(f"Gmail falló de su lado ({estado}).", codigo="falla_del_proveedor")
    raise ErrorDelProveedor(f"Gmail rechazó la consulta ({estado}{', ' + razon if razon else ''}).")


def _motivo_del_error(respuesta) -> tuple[str, str]:
    """(`reason` del primer error, `status` de Google), o vacíos.

    El cuerpo de error de las API de Google es
    `{"error": {"code", "message", "status", "errors": [{"reason", ...}]}}`.
    Se leen solo esos dos campos cortos; `message` no se propaga.
    """
    try:
        error = respuesta.json().get("error") or {}
    except (ValueError, AttributeError):
        return "", ""
    if not isinstance(error, dict):
        return "", ""
    razon = ""
    detalles = error.get("errors")
    if isinstance(detalles, list) and detalles and isinstance(detalles[0], dict):
        razon = str(detalles[0].get("reason") or "")[:40]
    return razon, str(error.get("status") or "")[:40]


# ── armar el mensaje ────────────────────────────────────────────────────────


def _mensaje(cuenta_id, crudo: dict) -> MensajeCorreo:
    """De lo que devuelve `messages.get?format=full` a un `MensajeCorreo`.
    `ValueError` si le falta lo indispensable (identificador o fecha)."""
    id_mensaje = crudo.get("id")
    if not isinstance(id_mensaje, str) or not id_mensaje:
        raise ValueError("el mensaje no trae identificador")
    try:
        milisegundos = int(crudo.get("internalDate"))
    except (TypeError, ValueError):
        raise ValueError("el mensaje no trae una fecha de recepción legible") from None
    recibido_en = datetime.fromtimestamp(milisegundos / 1000, tz=tz.utc)

    carga = crudo.get("payload") if isinstance(crudo.get("payload"), dict) else {}
    cabeceras = _cabeceras(carga)
    texto = _texto(carga)
    truncado = len(texto) > LARGO_MAXIMO_TEXTO
    return MensajeCorreo(
        cuenta_id=cuenta_id,
        id_mensaje=id_mensaje,
        id_hilo=str(crudo.get("threadId") or ""),
        recibido_en=recibido_en,
        remitente=cabeceras.get("from", "")[:320],
        asunto=cabeceras.get("subject", "")[:500],
        texto=texto[:LARGO_MAXIMO_TEXTO],
        texto_truncado=truncado,
    )


def _cabeceras(carga: dict) -> dict[str, str]:
    """Las cabeceras de nivel superior, en minúsculas, la primera de cada una."""
    resultado: dict[str, str] = {}
    for cabecera in carga.get("headers") or []:
        if not isinstance(cabecera, dict):
            continue
        nombre = str(cabecera.get("name") or "").lower()
        if nombre and nombre not in resultado:
            resultado[nombre] = _decodificar_cabecera(str(cabecera.get("value") or ""))
    return resultado


def _decodificar_cabecera(valor: str) -> str:
    """Gmail ya entrega las cabeceras decodificadas, pero un `=?UTF-8?...?=`
    suelto se ha visto en remitentes mal formados: se decodifica si se puede."""
    if "=?" not in valor:
        return valor
    try:
        return str(make_header(decode_header(valor)))
    except (ValueError, LookupError, UnicodeDecodeError):
        return valor


def _texto(carga: dict) -> str:
    """El texto del mensaje: las partes `text/plain`, o el HTML pasado a texto
    si no hay ninguna. Los adjuntos (partes con nombre de archivo) no se leen.
    """
    planos: list[str] = []
    htmls: list[str] = []
    pendientes = [(carga, 0)]
    vistas = 0
    while pendientes and vistas < _PARTES_MAXIMAS:
        parte, profundidad = pendientes.pop(0)
        vistas += 1
        if not isinstance(parte, dict):
            continue
        hijas = parte.get("parts")
        if isinstance(hijas, list) and profundidad < _PROFUNDIDAD_MAXIMA:
            pendientes.extend((hija, profundidad + 1) for hija in hijas)
        if parte.get("filename"):
            continue
        tipo = str(parte.get("mimeType") or "").lower()
        if tipo not in ("text/plain", "text/html"):
            continue
        datos = (parte.get("body") or {}).get("data") if isinstance(parte.get("body"), dict) else None
        if not isinstance(datos, str) or not datos:
            continue
        contenido = _base64url(datos, _juego_de_caracteres(parte))
        (planos if tipo == "text/plain" else htmls).append(contenido)
    if planos:
        return "\n".join(planos).strip()
    return _html_a_texto("\n".join(htmls)).strip()


def _juego_de_caracteres(parte: dict) -> str:
    for cabecera in parte.get("headers") or []:
        if isinstance(cabecera, dict) and str(cabecera.get("name") or "").lower() == "content-type":
            encontrado = re.search(r'charset="?([A-Za-z0-9._-]+)"?', str(cabecera.get("value") or ""))
            if encontrado:
                return encontrado.group(1)
    return "utf-8"


def _base64url(datos: str, juego: str) -> str:
    """Gmail entrega el cuerpo en base64url sin relleno, ya sin el
    Content-Transfer-Encoding del correo."""
    crudo = base64.urlsafe_b64decode(datos + "=" * (-len(datos) % 4))
    try:
        return crudo.decode(juego, errors="replace")
    except LookupError:
        return crudo.decode("utf-8", errors="replace")


class _ExtractorDeTexto(HTMLParser):
    """HTML a texto, sin dependencias: se queda con el texto visible y salta
    `script`, `style` y `head`. Los bloques terminan en salto de línea para
    que un importe no quede pegado a la palabra de la celda vecina."""

    _OCULTOS = {"script", "style", "head", "title"}
    _BLOQUES = {"p", "div", "br", "tr", "li", "table", "h1", "h2", "h3", "h4", "td", "th"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._partes: list[str] = []
        self._oculto = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._OCULTOS:
            self._oculto += 1
        elif tag in self._BLOQUES:
            self._partes.append("\n")

    def handle_endtag(self, tag):
        if tag in self._OCULTOS and self._oculto:
            self._oculto -= 1
        elif tag in self._BLOQUES:
            self._partes.append("\n")

    def handle_data(self, data):
        if not self._oculto:
            self._partes.append(data)

    def texto(self) -> str:
        unido = "".join(self._partes)
        lineas = (re.sub(r"[ \t ]+", " ", linea).strip() for linea in unido.splitlines())
        return "\n".join(linea for linea in lineas if linea)


def _html_a_texto(html: str) -> str:
    if not html:
        return ""
    extractor = _ExtractorDeTexto()
    extractor.feed(html)
    extractor.close()
    return extractor.texto()

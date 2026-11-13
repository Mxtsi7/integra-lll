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

Lo que tiene que decir lo mismo para Gmail y para Outlook —qué cuenta se puede
leer, qué se devuelve, qué errores, el filtro y el paso de HTML a texto— vive
en `lectura_correo.py`. Aquí queda lo que es de Google.

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
import re
from datetime import datetime, timezone as tz
from email.header import decode_header, make_header

import requests

from .lectura_correo import (  # noqa: F401 — se reexportan para quien importe desde aquí
    LARGO_MAXIMO_TEXTO,
    LIMITE_MAXIMO,
    LIMITE_POR_DEFECTO,
    PALABRAS_DE_COBRO,
    AutorizacionRechazada,
    CuentaNoDisponible,
    ErrorDeLectura,
    ErrorDelProveedor,
    ErrorTransitorio,
    FiltroCorreos,
    MensajeCorreo,
    MensajeOmitido,
    PaginaDeMensajes,
    html_a_texto,
    recortar,
    validar_limite,
)
from .lectura_correo import cuenta_para_leer as _cuenta_para_leer
from .models import CuentaConectada
from .proveedores import TIEMPO_LIMITE

URL_MENSAJES = "https://gmail.googleapis.com/gmail/v1/users/me/messages"

#: Un `pageToken` de Gmail es una cadena corta. Uno de este largo no lo
#: emitió Google y no se reenvía.
LARGO_MAXIMO_PAGINA = 512

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


# ── la búsqueda y la cuenta ─────────────────────────────────────────────────


def consulta_gmail(filtro: FiltroCorreos) -> str:
    """El parámetro `q` de Gmail para el filtro, ya validado.

    `desde` y `hasta` van en segundos epoch, que es la forma en que Gmail no
    depende de la zona horaria de la cuenta. `{a b}` es "a o b".
    """
    filtro.validar()
    partes: list[str] = []
    if filtro.desde:
        partes.append(f"after:{int(filtro.desde.timestamp())}")
    if filtro.hasta:
        partes.append(f"before:{int(filtro.hasta.timestamp())}")
    if filtro.remitentes:
        partes.append("from:(" + " OR ".join(filtro.remitentes) + ")")
    if filtro.solo_cobros:
        partes.append("{" + " ".join(PALABRAS_DE_COBRO) + "}")
    return " ".join(partes)


#: El proveedor de este lector, para quien lo use sin saber cuál es (S3-FE-19).
PROVEEDOR = CuentaConectada.Proveedor.GMAIL


def cuenta_para_leer(*, organizacion_id, cuenta_id):
    """La cuenta de Gmail de esa organización y su token (ver `lectura_correo`)."""
    return _cuenta_para_leer(
        organizacion_id=organizacion_id, cuenta_id=cuenta_id, proveedor=PROVEEDOR,
    )


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
    validar_limite(limite)
    if pagina is not None and (not isinstance(pagina, str) or not pagina or len(pagina) > LARGO_MAXIMO_PAGINA):
        raise ValueError("`pagina` no es un token de página de Gmail.")
    consulta = consulta_gmail(filtro or FiltroCorreos())

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
    texto, truncado = recortar(_texto(carga))
    return MensajeCorreo(
        cuenta_id=cuenta_id,
        id_mensaje=id_mensaje,
        id_hilo=str(crudo.get("threadId") or ""),
        recibido_en=recibido_en,
        remitente=cabeceras.get("from", "")[:320],
        asunto=cabeceras.get("subject", "")[:500],
        texto=texto,
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
    return html_a_texto("\n".join(htmls)).strip()


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

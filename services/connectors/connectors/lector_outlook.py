"""S3-FE-04 — consultar los mensajes de una cuenta de Outlook autorizada.

Es el gemelo de `lector_gmail` (S3-FE-02) para Microsoft Graph. Lo que tiene
que decir lo mismo en los dos —qué cuenta se puede leer, qué se devuelve, qué
errores— vive en `lectura_correo.py`. Aquí queda lo que es de Microsoft.

── Lo que cambia respecto de Gmail ─────────────────────────────────────────
- **Una sola llamada por página.** Graph devuelve el cuerpo de cada mensaje en
  la misma lista (`$select=...,body`), así que no hay una petición por
  mensaje como en Gmail.
- **La página siguiente es una URL completa** (`@odata.nextLink`), y Microsoft
  pide usarla tal cual, sin sacarle el `$skip`. Esa URL se le va a mandar con
  el token, así que **se valida antes de usarla**: tiene que ser
  `https://graph.microsoft.com/v1.0/me/messages`. Una URL que apunte a otro
  sitio se rechaza: si no, quien pueda poner una `pagina` podría llevarse el
  token a su servidor.
- **No se usa la búsqueda por palabras (`$search`).** Entrega 1000
  resultados como mucho y los ordena por fecha de envío: que no venga
  `@odata.nextLink` no quiere decir que se leyó todo, y S3-FE-05 avanza la
  marca justo con eso (revisión de #189). Por eso se enumera la ventana con
  `$filter` por fecha de recepción y `$orderby`, que Graph pagina sin tope, y
  las palabras de cobro y los remitentes se aplican de este lado con
  `FiltroCorreos.coincide`. Cuesta traer también los correos que no son
  cobros; es el precio de no perder ninguno.
- **El cuerpo se pide en texto** (`Prefer: outlook.body-content-type="text"`).
  La documentación dice también que la lista lo entrega solo en HTML, así que
  si llega HTML se pasa a texto igual.

Como en Gmail: lee y nada más, no guarda nada, no marca la cuenta, y los
errores salen con un `codigo` estable para S3-FE-18 y S3-FE-19.
"""

from __future__ import annotations

from datetime import datetime, timezone as tz
from urllib.parse import parse_qs, urlsplit

import requests

from .lectura_correo import normalizar_message_id
from .lectura_correo import (  # noqa: F401 — se reexportan para quien importe desde aquí
    LIMITE_MAXIMO,
    LIMITE_POR_DEFECTO,
    PALABRAS_DE_COBRO,
    AutorizacionRechazada,
    CuentaNoDisponible,
    CursorRechazado,
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
from .lectura_correo import atribuir_rechazo
from .lectura_correo import cuenta_para_leer as _cuenta_para_leer
from .models import CuentaConectada
from .proveedores import TIEMPO_LIMITE

URL_MENSAJES = "https://graph.microsoft.com/v1.0/me/messages"
_ESQUEMA, _SERVIDOR, _RUTA = "https", "graph.microsoft.com", "/v1.0/me/messages"

#: Una `@odata.nextLink` trae la consulta entera más un `$skip` o un
#: `$skiptoken`. Una de este largo no la armó Graph.
LARGO_MAXIMO_PAGINA = 4096

#: Lo que se le pide a Graph de cada mensaje. Lo demás no viaja.
_CAMPOS = "id,internetMessageId,conversationId,receivedDateTime,from,subject,body"

#: Códigos de error de Graph que significan "esta cuenta no tiene buzón al
#: que se pueda llegar por la API" (una cuenta personal sin Outlook.com, por
#: ejemplo). Reintentar no lo arregla.
_SIN_BUZON = {"MailboxNotEnabledForRESTAPI", "MailboxNotSupportedForRESTAPI", "ResourceNotFound"}

#: Tope para `Retry-After`: un valor absurdo no deja un worker dormido un día.
_ESPERA_MAXIMA = 3600

#: Cómo rechaza Graph una página siguiente que ya no sirve: como petición mal
#: hecha (400) o como algo que ya no existe (410, lo que usa para un estado de
#: sincronización vencido). Solo cuenta si se seguía una página.
_CURSOR_RECHAZADO = {400, 410}


# ── la búsqueda, la página y la cuenta ──────────────────────────────────────


def _fecha_odata(valor: datetime) -> str:
    return valor.astimezone(tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def filtro_fechas_outlook(filtro: FiltroCorreos) -> str:
    """El `$filter` por fecha de recepción, o "" si no hay fechas."""
    filtro.validar()
    partes = []
    if filtro.desde:
        partes.append(f"receivedDateTime ge {_fecha_odata(filtro.desde)}")
    if filtro.hasta:
        partes.append(f"receivedDateTime lt {_fecha_odata(filtro.hasta)}")
    return " and ".join(partes)


def es_pagina_de_graph(url) -> bool:
    """¿La URL es una página de la lista de mensajes de Graph y nada más?

    Se mira cada parte por separado y entera: esquema, servidor sin usuario
    ni puerto, la ruta exacta y sin fragmento. Comparar por prefijo dejaría
    pasar `https://graph.microsoft.com.otro.sitio/...` o `...@otro.sitio`.
    """
    if not isinstance(url, str) or not url or len(url) > LARGO_MAXIMO_PAGINA:
        return False
    if any(c.isspace() for c in url):
        return False
    try:
        partes = urlsplit(url)
    except ValueError:
        return False
    # `netloc` igual al servidor, entero: deja fuera un usuario
    # (`algo@graph...`) y un puerto (`graph...:8443`) sin mirarlos aparte.
    return (
        partes.scheme == _ESQUEMA
        and partes.netloc == _SERVIDOR
        and partes.path == _RUTA
        and not partes.fragment
        and tamano_de_pagina(url) is not None
    )


#: Si la página no dice su `$top`, Graph entrega su tamaño por omisión.
_TAMANO_POR_OMISION_DE_GRAPH = 10


def tamano_de_pagina(url: str) -> int | None:
    """Cuántos mensajes trae como mucho esa página, según su `$top`.

    `None` si el `$top` no es un número entre 1 y `LIMITE_MAXIMO`, o si viene
    repetido: una página así no la armó este lector y no se sigue. Sin `$top`,
    el tamaño por omisión de Graph.
    """
    try:
        valores = parse_qs(urlsplit(url).query, keep_blank_values=True).get("$top")
    except ValueError:
        return None
    if valores is None:
        return _TAMANO_POR_OMISION_DE_GRAPH
    if len(valores) != 1 or not valores[0].isdigit():
        return None
    tamano = int(valores[0])
    return tamano if 1 <= tamano <= LIMITE_MAXIMO else None


#: El proveedor de este lector, para quien lo use sin saber cuál es (S3-FE-19).
PROVEEDOR = CuentaConectada.Proveedor.OUTLOOK


def cuenta_para_leer(*, organizacion_id, cuenta_id):
    """La cuenta de Outlook de esa organización y su token (ver `lectura_correo`)."""
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

    `pagina` es el `siguiente_pagina` de la llamada anterior. Si se pasa, ya
    trae la consulta completa: el filtro y el límite se vuelven a validar
    pero no se reenvían, y el mismo filtro se aplica a lo que llega
    (palabras, remitentes y fechas). Hay que pasar el mismo de la primera.

    Una página puede venir sin ningún mensaje y con página siguiente: en ese
    tramo de la ventana no había cobros.

    ── Una página se procesa entera ─────────────────────────────────────
    El tamaño de una página que se sigue lo fija su `$top`, no el `limite`
    de esta llamada. Antes se recortaba a `limite`: seguir una página de 25
    con `limite=5` devolvía 5, conservaba el cursor que ya avanzaba después
    de los 25 y los otros 20 se perdían sin aviso. Lo encontró la revisión
    de #177. Si Graph devuelve MÁS de lo pedido, es un error explícito: no
    se recorta.
    """
    validar_limite(limite)
    filtro = filtro or FiltroCorreos()
    fechas = filtro_fechas_outlook(filtro)
    if pagina is not None and not es_pagina_de_graph(pagina):
        raise ValueError("`pagina` no es una página de mensajes de Microsoft Graph.")

    cuenta, token = cuenta_para_leer(organizacion_id=organizacion_id, cuenta_id=cuenta_id)

    # Un 401 que salga de aquí dice con qué credenciales se pidió (S3-FE-19).
    with atribuir_rechazo(cuenta, token):
        if pagina:
            cuerpo = _pedir(pagina, token, None)
        else:
            # Sin `$search`: ver el módulo. Graph exige que lo que va en
            # `$orderby` aparezca antes en `$filter` (si no,
            # `InefficientFilter`): aquí es la misma fecha.
            parametros = {"$top": limite, "$select": _CAMPOS, "$orderby": "receivedDateTime desc"}
            if fechas:
                parametros["$filter"] = fechas
            cuerpo = _pedir(URL_MENSAJES, token, parametros)

        crudos = cuerpo.get("value")
        if not isinstance(crudos, list):
            raise ErrorDelProveedor("Graph devolvió una lista de mensajes que no es una lista.")
        pedidos = tamano_de_pagina(pagina) if pagina else limite
        if len(crudos) > pedidos:
            raise ErrorDelProveedor(
                f"Graph devolvió {len(crudos)} mensajes y se pidieron {pedidos}; no se recorta para no perder ninguno."
            )

        mensajes: list[MensajeCorreo] = []
        omitidos: list[MensajeOmitido] = []
        for crudo in crudos:
            # Lo que no es un cobro (o no es de esos remitentes) se descarta
            # antes de armarlo: si le falta la fecha, tampoco es un omitido.
            if isinstance(crudo, dict) and not _coincide(filtro, crudo):
                continue
            try:
                mensaje = _mensaje(cuenta.pk, crudo)
            except ValueError as exc:
                identificador = crudo.get("id") if isinstance(crudo, dict) else None
                omitidos.append(MensajeOmitido(str(identificador)[:64], str(exc)[:120]))
                continue
            # Graph ya filtró las fechas, pero a la hora redondeada al
            # segundo; aquí se aplican exactas. Quedar fuera no es un omitido.
            if not filtro.admite(mensaje.recibido_en):
                continue
            mensajes.append(mensaje)

        siguiente = cuerpo.get("@odata.nextLink")
        if siguiente is not None and not es_pagina_de_graph(siguiente):
            # No se devuelve una página que la llamada siguiente rechazaría, ni
            # una que lleve el token a otro lado.
            raise ErrorDelProveedor("Graph devolvió una página siguiente que no es de la lista de mensajes.")
        return PaginaDeMensajes(tuple(mensajes), siguiente or None, tuple(omitidos))


def _pedir(url: str, token: str, parametros: dict | None) -> dict:
    """Un GET a Graph con el token. Ningún mensaje de error lleva el token,
    la URL ni el `message` de Graph."""
    try:
        respuesta = requests.get(
            url,
            params=parametros,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                # `ImmutableId`: sin esto, el `id` de un mensaje CAMBIA si el
                # usuario lo mueve de carpeta, y el mismo correo archivado
                # tendría otra identidad (S3-FE-06).
                "Prefer": 'outlook.body-content-type="text", IdType="ImmutableId"',
            },
            timeout=TIEMPO_LIMITE,
            # Graph no redirige la lista de mensajes. Seguir una redirección
            # sería mandar el token a donde diga la respuesta.
            allow_redirects=False,
        )
    except requests.Timeout:
        raise ErrorTransitorio("Graph no contestó a tiempo.", codigo="tiempo_agotado") from None
    except requests.RequestException:
        raise ErrorTransitorio("No se pudo contactar a Graph.", codigo="sin_conexion") from None

    estado = respuesta.status_code
    if estado == 200:
        try:
            cuerpo = respuesta.json()
        except ValueError:
            raise ErrorDelProveedor("Graph respondió algo que no es JSON.") from None
        if not isinstance(cuerpo, dict):
            raise ErrorDelProveedor("Graph respondió un JSON que no es un objeto.")
        return cuerpo

    codigo_graph = _codigo_del_error(respuesta)
    detalle = f"{estado}{', ' + codigo_graph if codigo_graph else ''}"
    if estado == 401:
        raise AutorizacionRechazada(f"Graph rechazó el token de acceso ({detalle}).")
    if estado == 403:
        raise AutorizacionRechazada(f"Graph negó el acceso ({detalle}).", codigo="permiso_insuficiente")
    if estado == 404 and codigo_graph in _SIN_BUZON:
        raise ErrorDelProveedor(
            f"La cuenta no tiene un buzón al que se pueda llegar por Graph ({detalle}).",
            codigo="buzon_no_disponible",
        )
    if estado == 429 or estado >= 500:
        raise ErrorTransitorio(
            f"Graph pidió esperar o falló de su lado ({detalle}).",
            codigo="cuota_excedida" if estado == 429 else "falla_del_proveedor",
            reintentar_en=_reintentar_en(respuesta),
        )
    if parametros is None and estado in _CURSOR_RECHAZADO:
        # Se seguía una `@odata.nextLink` que Graph armó con una consulta que
        # ya aceptó: lo que rechaza es la página (S3-FE-05).
        raise CursorRechazado(f"Graph rechazó la página siguiente ({detalle}).")
    raise ErrorDelProveedor(f"Graph rechazó la consulta ({detalle}).")


def _codigo_del_error(respuesta) -> str:
    """El `error.code` de Graph (`{"error": {"code", "message", "innerError"}}`).
    Se lee solo ese campo corto; `message` no se propaga."""
    try:
        error = respuesta.json().get("error") or {}
    except (ValueError, AttributeError):
        return ""
    if not isinstance(error, dict):
        return ""
    codigo = str(error.get("code") or "")
    return codigo[:60] if codigo.replace("_", "").isalnum() else ""


def _reintentar_en(respuesta) -> int | None:
    """`Retry-After` en segundos, si vino y es un número razonable."""
    valor = (getattr(respuesta, "headers", None) or {}).get("Retry-After")
    try:
        segundos = int(str(valor).strip())
    except (TypeError, ValueError):
        return None
    return segundos if 0 <= segundos <= _ESPERA_MAXIMA else None


# ── armar el mensaje ────────────────────────────────────────────────────────


def _coincide(filtro: FiltroCorreos, crudo: dict) -> bool:
    """Las palabras y los remitentes del filtro, sobre el mensaje tal como lo
    entrega Graph: asunto, cuerpo y quien lo envía (nombre y dirección, como
    los miraba `$search`)."""
    remitente = crudo["from"].get("emailAddress") if isinstance(crudo.get("from"), dict) else None
    remitente = remitente if isinstance(remitente, dict) else {}
    cuerpo = crudo.get("body") if isinstance(crudo.get("body"), dict) else {}
    direccion = str(remitente.get("address") or "")
    return filtro.coincide(
        direccion=direccion,
        textos=(crudo.get("subject"), cuerpo.get("content"), remitente.get("name"), direccion),
    )


def _mensaje(cuenta_id, crudo) -> MensajeCorreo:
    """De un elemento de `value` a un `MensajeCorreo`. `ValueError` si le
    falta lo indispensable (identificador o fecha)."""
    if not isinstance(crudo, dict):
        raise ValueError("el mensaje no es un objeto")
    id_mensaje = crudo.get("id")
    if not isinstance(id_mensaje, str) or not id_mensaje or len(id_mensaje) > 512 or not id_mensaje.isprintable():
        raise ValueError("el mensaje no trae un identificador válido")
    recibido_en = _fecha(crudo.get("receivedDateTime"))

    cuerpo = crudo.get("body") if isinstance(crudo.get("body"), dict) else {}
    contenido = cuerpo.get("content") if isinstance(cuerpo.get("content"), str) else ""
    if str(cuerpo.get("contentType") or "").lower() == "html":
        contenido = html_a_texto(contenido)
    texto, truncado = recortar(contenido.strip())

    return MensajeCorreo(
        cuenta_id=cuenta_id,
        id_mensaje=id_mensaje,
        id_hilo=str(crudo.get("conversationId") or ""),
        recibido_en=recibido_en,
        remitente=_remitente(crudo.get("from"))[:320],
        asunto=str(crudo.get("subject") or "")[:500],
        texto=texto,
        texto_truncado=truncado,
        proveedor_correo=PROVEEDOR,
        message_id=normalizar_message_id(crudo.get("internetMessageId")),
    )


def _fecha(valor) -> datetime:
    """`receivedDateTime` viene en ISO 8601 y en UTC (`2026-10-01T11:00:00Z`).
    Una fecha sin zona no se adivina."""
    if not isinstance(valor, str) or not valor:
        raise ValueError("el mensaje no trae una fecha de recepción legible")
    try:
        fecha = datetime.fromisoformat(valor)
    except ValueError:
        raise ValueError("el mensaje no trae una fecha de recepción legible") from None
    if fecha.tzinfo is None:
        raise ValueError("la fecha de recepción no trae zona horaria")
    return fecha.astimezone(tz.utc)


def _remitente(valor) -> str:
    """`{"emailAddress": {"name", "address"}}` a `Nombre <dirección>`."""
    direccion = valor.get("emailAddress") if isinstance(valor, dict) else None
    if not isinstance(direccion, dict):
        return ""
    nombre = str(direccion.get("name") or "").strip()
    correo = str(direccion.get("address") or "").strip()
    if nombre and correo and nombre != correo:
        return f"{nombre} <{correo}>"
    return correo or nombre

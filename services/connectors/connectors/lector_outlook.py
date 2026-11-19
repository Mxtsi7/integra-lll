"""S3-FE-04 — consultar los mensajes de una cuenta de Outlook autorizada.

Es el gemelo de `lector_gmail` (S3-FE-02) para Microsoft Graph. Lo que tiene
que decir lo mismo en los dos —qué cuenta se puede leer, qué se devuelve, qué
errores— vive en `lectura_correo.py`. Aquí queda lo que es de Microsoft.

── Lo que cambia respecto de Gmail ─────────────────────────────────────────
- **Una sola llamada por página.** Graph devuelve el cuerpo de cada mensaje en
  la misma lista (`$select=...,body`), así que no hay una petición por
  mensaje como en Gmail.
- **La página siguiente la arma este lector, por fecha**, y no es la
  `@odata.nextLink` de Graph. Ver abajo.
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

── La página siguiente, por fecha y no por posición ────────────────────────
La `@odata.nextLink` de la lista de mensajes avanza con `$skip`: «saltar los
primeros N». Si a mitad de una corrida se borraba definitivamente un correo
ya leído, los que seguían se corrían un lugar y el del borde de la página no
se entregaba nunca, con la marca de S3-FE-05 avanzando igual (revisión de
#189, ronda 3).

Por eso cada página es una consulta nueva: el mismo `$filter` y el mismo
orden, con el tope cambiado por `receivedDateTime lt <corte>`. El cursor que
se devuelve guarda ese corte y nada que dependa de la posición:

- **el corte** es el último segundo que se vio más uno. Graph muestra la
  fecha al segundo, pero el buzón la guarda con fracción: cortar en
  `lt <último segundo>` dejaría fuera a los de ese mismo segundo que no
  alcanzaron a entrar en la página. Con `lt <último segundo + 1 s>` vuelven
  a venir todos los de ese segundo;
- **los vistos** son una huella del `id` de los de ese último segundo que ya
  se vieron. Se reconocen y no se entregan dos veces. Para que quepan los
  nuevos, se piden `limite` más los vistos.

Si se borra un correo de cualquier lado, los demás siguen dentro de la
consulta: no se salta ninguno. De la `@odata.nextLink` solo se usa que venga,
que quiere decir que hay más; nunca se pide. Así tampoco hay una URL que
validar: el token va siempre a `URL_MENSAJES`.

Dos casos no avanzan, y son errores explícitos, no una página vacía:
`pagina_sin_avance` (Graph dice que hay más y no entrega nada nuevo) y
`demasiados_en_un_segundo` (más de `MAXIMO_VISTOS` correos recibidos en el
mismo segundo, que ya no caben en una página).

Como en Gmail: lee y nada más, no guarda nada, no marca la cuenta, y los
errores salen con un `codigo` estable para S3-FE-18 y S3-FE-19.
"""

from __future__ import annotations

import dataclasses
import hashlib
import re
from datetime import datetime, timedelta, timezone as tz

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

#: Lo que se le pide a Graph de cada mensaje. Lo demás no viaja.
_CAMPOS = "id,internetMessageId,conversationId,receivedDateTime,from,subject,body"

#: Códigos de error de Graph que significan "esta cuenta no tiene buzón al
#: que se pueda llegar por la API" (una cuenta personal sin Outlook.com, por
#: ejemplo). Reintentar no lo arregla.
_SIN_BUZON = {"MailboxNotEnabledForRESTAPI", "MailboxNotSupportedForRESTAPI", "ResourceNotFound"}

#: Tope para `Retry-After`: un valor absurdo no deja un worker dormido un día.
_ESPERA_MAXIMA = 3600

#: Cuántos correos del mismo segundo puede recordar el cursor. Uno menos que
#: el `$top` más grande que se pide, para que siempre quepa uno nuevo.
MAXIMO_VISTOS = LIMITE_MAXIMO - 1

#: El cursor: `antes-de=AAAAMMDDTHHMMSSZ`, y `&vistos=` con las huellas
#: (16 hexadecimales) de los de ese último segundo ya vistos.
_CURSOR = re.compile(r"antes-de=([0-9]{8}T[0-9]{6}Z)(?:&vistos=([0-9a-f]{16}(?:,[0-9a-f]{16})*))?")
_FORMATO_DEL_CORTE = "%Y%m%dT%H%M%SZ"


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


def _huella(id_mensaje: str) -> str:
    """Corta y estable: el `id` es inmutable (`ImmutableId`) pero largo."""
    return hashlib.sha256(id_mensaje.encode("utf-8")).hexdigest()[:16]


@dataclasses.dataclass(frozen=True)
class _Cursor:
    #: Exclusivo y al segundo: la página siguiente es lo recibido antes.
    corte: datetime
    #: Huellas de los del segundo anterior al corte que ya se vieron.
    vistos: frozenset[str] = frozenset()

    def texto(self) -> str:
        texto = f"antes-de={self.corte.strftime(_FORMATO_DEL_CORTE)}"
        return texto + (f"&vistos={','.join(sorted(self.vistos))}" if self.vistos else "")

    @classmethod
    def leer(cls, texto) -> "_Cursor":
        """`ValueError` si no es un cursor que haya armado este lector."""
        ajena = ValueError("`pagina` no es una página que haya armado el lector de Outlook.")
        coincidencia = _CURSOR.fullmatch(texto) if isinstance(texto, str) else None
        if coincidencia is None:
            raise ajena
        try:
            corte = datetime.strptime(coincidencia.group(1), _FORMATO_DEL_CORTE).replace(tzinfo=tz.utc)
        except ValueError:
            raise ajena from None
        vistos = coincidencia.group(2).split(",") if coincidencia.group(2) else []
        if len(vistos) > MAXIMO_VISTOS or len(set(vistos)) != len(vistos):
            raise ajena
        return cls(corte, frozenset(vistos))


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

    `pagina` es el `siguiente_pagina` de la llamada anterior, y hay que pasar
    el mismo filtro de la primera: la página siguiente es esa misma consulta
    con un corte (ver el módulo). Una `pagina` que no armó este lector es un
    `ValueError`, sin hablar con Graph.

    Una página puede venir sin ningún mensaje y con página siguiente: en ese
    tramo de la ventana no había cobros.

    ── Una página se procesa entera ─────────────────────────────────────
    Se devuelve todo lo que llega, sin recortar. La revisión de #177 encontró
    que antes se recortaba a `limite` y se perdía lo demás sin aviso. Si Graph
    devuelve MÁS de lo pedido, es un error explícito.
    """
    validar_limite(limite)
    filtro = filtro or FiltroCorreos()
    filtro.validar()
    cursor = _Cursor.leer(pagina) if pagina is not None else None
    if cursor and filtro.desde and cursor.corte <= filtro.desde:
        raise ValueError("`pagina` es de otra ventana: hay que pasar el filtro de la primera página.")
    hasta = filtro.hasta
    if cursor:
        hasta = cursor.corte if hasta is None else min(hasta, cursor.corte)
    vistos = cursor.vistos if cursor else frozenset()
    pedidos = min(LIMITE_MAXIMO, limite + len(vistos))

    cuenta, token = cuenta_para_leer(organizacion_id=organizacion_id, cuenta_id=cuenta_id)

    # Un 401 que salga de aquí dice con qué credenciales se pidió (S3-FE-19).
    with atribuir_rechazo(cuenta, token):
        # Sin `$search`: ver el módulo. Graph exige que lo que va en
        # `$orderby` aparezca antes en `$filter` (si no, `InefficientFilter`):
        # aquí es la misma fecha.
        parametros = {"$top": pedidos, "$select": _CAMPOS, "$orderby": "receivedDateTime desc"}
        fechas = filtro_fechas_outlook(dataclasses.replace(filtro, hasta=hasta))
        if fechas:
            parametros["$filter"] = fechas
        cuerpo = _pedir(token, parametros)

        crudos = cuerpo.get("value")
        if not isinstance(crudos, list):
            raise ErrorDelProveedor("Graph devolvió una lista de mensajes que no es una lista.")
        if len(crudos) > pedidos:
            raise ErrorDelProveedor(
                f"Graph devolvió {len(crudos)} mensajes y se pidieron {pedidos}; no se recorta para no perder ninguno."
            )

        mensajes: list[MensajeCorreo] = []
        omitidos: list[MensajeOmitido] = []
        for crudo in crudos:
            if isinstance(crudo, dict) and isinstance(crudo.get("id"), str) and _huella(crudo["id"]) in vistos:
                # Del último segundo de la página anterior, y ya visto ahí.
                continue
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

        # De la `@odata.nextLink` solo importa que venga: hay más.
        siguiente = _cursor_siguiente(cursor, crudos) if cuerpo.get("@odata.nextLink") else None
        return PaginaDeMensajes(tuple(mensajes), siguiente, tuple(omitidos))


def _cursor_siguiente(anterior: _Cursor | None, crudos: list) -> str:
    """El cursor de la página que sigue a esta (ver el módulo): el último
    segundo que se vio más uno, y las huellas de los de ese segundo."""
    vistos_por_segundo: list[tuple[datetime, str]] = []
    for crudo in crudos:
        if not isinstance(crudo, dict) or not isinstance(crudo.get("id"), str) or not crudo["id"]:
            continue
        try:
            recibido = _fecha(crudo.get("receivedDateTime"))
        except ValueError:
            continue
        vistos_por_segundo.append((recibido.replace(microsecond=0), _huella(crudo["id"])))
    if not vistos_por_segundo:
        raise ErrorDelProveedor(
            "Graph dice que hay más mensajes y no entregó ninguno con fecha: no hay desde dónde seguir.",
            codigo="pagina_sin_avance",
        )

    ultimo_segundo = min(segundo for segundo, _ in vistos_por_segundo)
    corte = ultimo_segundo + timedelta(seconds=1)
    vistos = {huella for segundo, huella in vistos_por_segundo if segundo == ultimo_segundo}
    if anterior and corte == anterior.corte:
        # La página entera cayó en el mismo segundo que la anterior.
        vistos |= anterior.vistos
    siguiente = _Cursor(corte, frozenset(vistos))
    if siguiente == anterior:
        raise ErrorDelProveedor(
            "Graph dice que hay más mensajes y no entregó ninguno nuevo.", codigo="pagina_sin_avance",
        )
    if len(vistos) > MAXIMO_VISTOS:
        raise ErrorDelProveedor(
            f"Hay más de {MAXIMO_VISTOS} correos recibidos en el mismo segundo: no caben en una página.",
            codigo="demasiados_en_un_segundo",
        )
    return siguiente.texto()


def _pedir(token: str, parametros: dict) -> dict:
    """Un GET a la lista de mensajes con el token. Ningún mensaje de error
    lleva el token, la URL ni el `message` de Graph."""
    try:
        respuesta = requests.get(
            URL_MENSAJES,
            params=parametros,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                # `ImmutableId`: sin esto, el `id` de un mensaje CAMBIA si el
                # usuario lo mueve de carpeta, y el mismo correo archivado
                # tendría otra identidad (S3-FE-06) y otra huella en el cursor.
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
    # Un 400 o un 410 tampoco es un `CursorRechazado`: el cursor lo arma este
    # lector y Graph no lo conoce, así que no tiene cómo vencer.
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

"""S3-FE-06 — el servicio y el identificador de origen de cada mensaje.

Toma un `MensajeCorreo` de los lectores (S3-FE-02 Gmail, S3-FE-04 Outlook) y
responde dos preguntas, sin guardar nada:

    ¿quién es este mensaje?      `identificador_origen`, estable
    ¿de qué servicio habla?      `servicio`, normalizado con el catálogo de FE-12

── El identificador ────────────────────────────────────────────────────────
El contrato de candidatos (S3-FE-01) dice que en correo el identificador es el
**Message-ID**. Es mejor que el `id` de cada proveedor por tres razones:

- no cambia si el usuario mueve el correo de carpeta (el `id` de Outlook sí,
  salvo con `ImmutableId`);
- es el mismo en Gmail y en Outlook;
- un recibo que llega con copia a dos cuentas de la MISMA organización tiene
  un solo Message-ID: es un solo cobro y queda como uno.

Se guarda como `mid:` + sha256 del Message-ID. El hash no es para esconderlo
—va entero en la evidencia (S3-FE-09)— sino para que entre siempre en los 200
caracteres del campo: un Message-ID puede llegar a 998.

Si el correo no trae un Message-ID usable, se usa el del proveedor, que solo
es único dentro de un buzón: `gmail:` u `outlook:` + sha256(cuenta, id). Así
dos mensajes de buzones distintos no chocan nunca.

── El servicio: no se asigna a la fuerza ───────────────────────────────────
Se mira el **nombre** del remitente («Netflix»), su **dominio**
(`account.netflix.com`) y el **asunto**, cada uno con `normalizar` (FE-12).
El asunto solo DECIDE cuando el remitente no puede: si es un intermediario de
pago («PayPal» escribe «Recibo de tu pago a Spotify») o si es ambiguo y el
asunto lo resuelve («Microsoft» + «Tu factura de Microsoft 365»).

Si el remitente es cualquier otro, el asunto **no asigna**: «Gana Netflix
gratis con tu tarjeta», de una tienda, no es un cobro de Netflix. Queda como
sugerencia (ambiguo con ese candidato) para que lo vea una persona. Lo mismo
si el remitente y el asunto nombran servicios distintos. Las reglas, en orden,
están en `servicio_de`.

`fuente` dice de dónde salió, para poder explicar la decisión.
"""

from __future__ import annotations

import dataclasses
import hashlib
import re
from email.utils import parseaddr

from .lectura_correo import MensajeCorreo
from .normalizacion import AMBIGUO, RECONOCIDO, Normalizacion, _sin_tildes, normalizar

PREFIJO_MESSAGE_ID = "mid:"

#: De dónde salió el servicio.
FUENTE_NOMBRE = "nombre del remitente"
FUENTE_DOMINIO = "dominio del remitente"
FUENTE_ASUNTO = "asunto"
FUENTE_NINGUNA = ""


@dataclasses.dataclass(frozen=True)
class OrigenDelMensaje:
    identificador_origen: str
    servicio: Normalizacion
    fuente: str
    #: La dirección del remitente, sin el nombre. Para la evidencia.
    remitente: str


def identificador_de(mensaje: MensajeCorreo) -> str:
    """El identificador estable del mensaje. Ver la cabecera del módulo."""
    if mensaje.message_id:
        return PREFIJO_MESSAGE_ID + hashlib.sha256(mensaje.message_id.encode("utf-8")).hexdigest()
    if not mensaje.proveedor_correo or not mensaje.id_mensaje:
        raise ValueError("el mensaje no trae ni Message-ID ni identificador del proveedor")
    llave = f"{mensaje.cuenta_id}\x1f{mensaje.id_mensaje}"
    return f"{mensaje.proveedor_correo}:" + hashlib.sha256(llave.encode("utf-8")).hexdigest()


def _partes_del_remitente(remitente: str) -> tuple[str, str, str]:
    """(nombre, dirección, dominio) de `Nombre <dir@dominio>`."""
    nombre, direccion = parseaddr(remitente or "")
    direccion = direccion.strip()
    dominio = direccion.rpartition("@")[2] if "@" in direccion else ""
    return nombre.strip(), direccion, dominio.strip().lower()


#: Remitentes que cobran POR OTRO: el servicio está en el asunto, no en el
#: remitente. Una sola palabra cada uno, comparada entera, para que «flow» no
#: calce dentro de cualquier palabra. Salen de `normalizacion.INTERMEDIARIOS`
#: sin las siglas cortas (`pp`, `dl`, `mp`), que en un remitente no dicen nada.
INTERMEDIARIOS_DE_PAGO = frozenset({
    "paypal", "dlocal", "mercadopago", "webpay", "transbank", "stripe", "sumup", "flow",
})


def _es_intermediario(*textos: str) -> bool:
    for texto in textos:
        palabras = re.findall(r"[a-z0-9]+", _sin_tildes(texto or "").lower())
        if INTERMEDIARIOS_DE_PAGO.intersection(palabras) or "mercado pago" in " ".join(palabras):
            return True
    return False


def _sugerencia(asunto: Normalizacion, regla: str, candidatos: tuple[str, ...]) -> Normalizacion:
    """Un ambiguo armado aquí: el servicio NO se asigna, se propone."""
    return Normalizacion(
        original=asunto.original,
        limpio=asunto.limpio,
        resultado=AMBIGUO,
        proveedor=None,
        categoria=None,
        candidatos=tuple(sorted(set(candidatos))),
        regla=regla,
    )


def servicio_de(mensaje: MensajeCorreo) -> tuple[Normalizacion, str]:
    """(el servicio, de dónde salió). Las reglas, en orden:

    1. El remitente (nombre, después dominio) reconoce un servicio → ese. Si
       el asunto reconoce OTRO, ambiguo con los dos.
    2. El remitente es ambiguo (Apple, Microsoft, Google, Amazon) → si el
       asunto reconoce uno de sus candidatos, ese; si reconoce otro (Apple
       también cobra suscripciones ajenas), ambiguo con todos; si no, el
       ambiguo del remitente.
    3. El remitente es un intermediario de pago (PayPal, Mercado Pago) → el
       servicio es el del asunto, si lo reconoce.
    4. El remitente no es nada de lo anterior → el asunto **no decide**. Si
       nombra un servicio, queda como sugerencia (ambiguo con ese candidato):
       «Gana Netflix gratis con tu tarjeta», de una tienda, no es Netflix.
    """
    nombre, _, dominio = _partes_del_remitente(mensaje.remitente)
    por_nombre = normalizar(nombre) if nombre else None
    por_dominio = normalizar(dominio) if dominio else None
    por_asunto = normalizar(mensaje.asunto) if mensaje.asunto else None
    asunto = por_asunto.proveedor if por_asunto is not None and por_asunto.resultado == RECONOCIDO else None

    del_remitente = [(r, f) for r, f in ((por_nombre, FUENTE_NOMBRE), (por_dominio, FUENTE_DOMINIO)) if r is not None]

    # 1. reconocido por el remitente
    for resultado, fuente in del_remitente:
        if resultado.resultado == RECONOCIDO:
            if asunto and asunto != resultado.proveedor:
                return _sugerencia(
                    por_asunto,
                    f"el remitente dice {resultado.proveedor} y el asunto {asunto}; queda para revision",
                    (resultado.proveedor, asunto),
                ), FUENTE_NINGUNA
            return resultado, fuente

    # 2. ambiguo por el remitente
    for resultado, fuente in del_remitente:
        if resultado.resultado == AMBIGUO:
            if asunto and asunto in resultado.candidatos:
                return por_asunto, FUENTE_ASUNTO
            if asunto:
                return _sugerencia(
                    por_asunto,
                    f"el remitente puede ser {', '.join(resultado.candidatos)} y el asunto dice {asunto}; "
                    "queda para revision",
                    (*resultado.candidatos, asunto),
                ), FUENTE_NINGUNA
            return resultado, fuente

    # 3. intermediario de pago
    if _es_intermediario(nombre, dominio):
        if por_asunto is not None and por_asunto.resultado in (RECONOCIDO, AMBIGUO):
            return por_asunto, FUENTE_ASUNTO
        return normalizar(mensaje.asunto or ""), FUENTE_NINGUNA

    # 4. remitente desconocido
    if asunto:
        return _sugerencia(
            por_asunto,
            f"solo el asunto nombra a {asunto} y el remitente no es de {asunto} ni un "
            "intermediario de pago; queda para revision",
            (asunto,),
        ), FUENTE_NINGUNA
    if por_asunto is not None and por_asunto.resultado == AMBIGUO:
        return por_asunto, FUENTE_ASUNTO
    return normalizar(nombre or dominio or ""), FUENTE_NINGUNA


def origen_de(mensaje: MensajeCorreo) -> OrigenDelMensaje:
    servicio, fuente = servicio_de(mensaje)
    return OrigenDelMensaje(
        identificador_origen=identificador_de(mensaje),
        servicio=servicio,
        fuente=fuente,
        remitente=_partes_del_remitente(mensaje.remitente)[1],
    )

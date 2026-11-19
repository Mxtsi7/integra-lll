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
from .normalizacion import (
    AMBIGUO,
    RECONOCIDO,
    Normalizacion,
    _alias_ordenados,
    _es_transferencia,
    _sin_tildes,
    limpiar,
    normalizar,
)

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
    return identificador_del_proveedor(mensaje.proveedor_correo, mensaje.cuenta_id, mensaje.id_mensaje)


def identificador_del_proveedor(proveedor_correo: str, cuenta_id, id_mensaje: str) -> str:
    """El respaldo sin Message-ID: único dentro de un buzón, por eso lleva la
    cuenta. Aparte porque S3-FE-09 también lo usa para identificar un mensaje
    que la lista nombró pero no se pudo leer (`MensajeOmitido`), que no trae
    más que el `id` del proveedor."""
    if not proveedor_correo or not id_mensaje:
        raise ValueError("el mensaje no trae ni Message-ID ni identificador del proveedor")
    llave = f"{cuenta_id}\x1f{id_mensaje}"
    return f"{proveedor_correo}:" + hashlib.sha256(llave.encode("utf-8")).hexdigest()


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


def servicios_mencionados(texto: str) -> tuple[str, ...]:
    """Todos los servicios que el texto nombra, cada uno una vez, en orden.

    `normalizar` devuelve la PRIMERA coincidencia, y eso sirve para un nombre
    («NETFLIX.COM»), no para un asunto que nombra dos: «Recibo de Netflix y
    Spotify» salía como Netflix. Lo encontró la revisión de #183. Aquí se
    recorren los alias del más largo al más corto, como `normalizar`, y lo
    que calza se borra antes de seguir: así un alias genérico metido en uno
    específico no cuenta aparte («amazon prime video» no suma un «amazon»).

    Los alias débiles (palabras comunes) y los ambiguos («apple») no cuentan:
    no reconocen nada por sí solos dentro de una frase.
    """
    limpio = limpiar(texto or "")
    if not limpio or _es_transferencia(limpio):
        return ()
    encontrados: list[str] = []
    for alias, proveedor, debil in _alias_ordenados():
        patron = re.compile(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])")
        if not patron.search(limpio):
            continue
        limpio = patron.sub(" ", limpio)
        if proveedor is not None and not debil and proveedor.nombre not in encontrados:
            encontrados.append(proveedor.nombre)
    return tuple(encontrados)


def servicio_de(mensaje: MensajeCorreo) -> tuple[Normalizacion, str]:
    """(el servicio, de dónde salió). Las reglas, en orden:

    1. El remitente (nombre, después dominio) reconoce un servicio → ese. Si
       el asunto nombra OTRO, ambiguo con todos.
    2. El remitente es ambiguo (Apple, Microsoft, Google, Amazon) → si el
       asunto nombra uno solo y es uno de sus candidatos, ese; si nombra
       otros (Apple también cobra suscripciones ajenas), ambiguo con todos;
       si no nombra ninguno, el ambiguo del remitente.
    3. El remitente es un intermediario de pago (PayPal, Mercado Pago) → el
       servicio es el del asunto, si nombra UNO. Si nombra varios, ambiguo.
    4. El remitente no es nada de lo anterior → el asunto **no decide**. Si
       nombra servicios, quedan como sugerencia (ambiguo con ellos):
       «Gana Netflix gratis con tu tarjeta», de una tienda, no es Netflix.
    """
    nombre, _, dominio = _partes_del_remitente(mensaje.remitente)
    por_nombre = normalizar(nombre) if nombre else None
    por_dominio = normalizar(dominio) if dominio else None
    por_asunto = normalizar(mensaje.asunto) if mensaje.asunto else None
    servicios = servicios_mencionados(mensaje.asunto)
    if not servicios and por_asunto is not None and por_asunto.resultado == RECONOCIDO:
        # Un alias débil que es TODO el asunto («Canva»): `normalizar` lo
        # reconoce y la búsqueda dentro de frases, a propósito, no.
        servicios = (por_asunto.proveedor,)
    unico = servicios[0] if len(servicios) == 1 else None
    lista = ", ".join(servicios)

    del_remitente = [(r, f) for r, f in ((por_nombre, FUENTE_NOMBRE), (por_dominio, FUENTE_DOMINIO)) if r is not None]

    # 1. reconocido por el remitente
    for resultado, fuente in del_remitente:
        if resultado.resultado == RECONOCIDO:
            otros = tuple(s for s in servicios if s != resultado.proveedor)
            if otros:
                return _sugerencia(
                    por_asunto,
                    f"el remitente dice {resultado.proveedor} y el asunto nombra {lista}; queda para revision",
                    (resultado.proveedor, *otros),
                ), FUENTE_NINGUNA
            return resultado, fuente

    # 2. ambiguo por el remitente
    for resultado, fuente in del_remitente:
        if resultado.resultado == AMBIGUO:
            if unico and unico in resultado.candidatos and por_asunto.proveedor == unico:
                return por_asunto, FUENTE_ASUNTO
            if servicios:
                return _sugerencia(
                    por_asunto,
                    f"el remitente puede ser {', '.join(resultado.candidatos)} y el asunto nombra {lista}; "
                    "queda para revision",
                    (*resultado.candidatos, *servicios),
                ), FUENTE_NINGUNA
            return resultado, fuente

    # 3. intermediario de pago
    if _es_intermediario(nombre, dominio):
        if unico and por_asunto.proveedor == unico:
            return por_asunto, FUENTE_ASUNTO
        if servicios:
            return _sugerencia(
                por_asunto,
                f"el asunto nombra varios servicios ({lista}); queda para revision",
                servicios,
            ), FUENTE_NINGUNA
        if por_asunto is not None and por_asunto.resultado == AMBIGUO:
            return por_asunto, FUENTE_ASUNTO
        return normalizar(mensaje.asunto or ""), FUENTE_NINGUNA

    # 4. remitente desconocido
    if servicios:
        return _sugerencia(
            por_asunto,
            f"solo el asunto nombra a {lista} y el remitente no es del servicio ni un "
            "intermediario de pago; queda para revision",
            servicios,
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

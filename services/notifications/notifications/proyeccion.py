"""Traducción de eventos a la proyección de suscripciones (FE-17 / FE-18).

Esto es el adaptador: toma un sobre del catálogo (MX-21 v2) y actualiza
`SuscripcionVigilada`. Está separado del consumidor de RabbitMQ a propósito:
FE-24 va a enganchar el broker; esto se prueba sin levantarlo.

── Qué eventos escucha ──────────────────────────────────────────────────────
    suscripcion.creada          nace la fila: nombre, monto, próximo cobro, estado
    suscripcion.actualizada     cambian monto, ciclo, próximo cobro…
    suscripcion.estado_cambiado cambia el estado (cancelada, fin de prueba…)

Los tres traen el snapshot completo de la suscripción (`$defs/suscripcion`),
así que los tres se aplican igual: se reemplaza lo que se sabe por lo que
dice el evento, si el evento es más nuevo que lo que ya se tenía.

── Fuera de orden y reentregas ──────────────────────────────────────────────
RabbitMQ entrega al menos una vez y no promete orden entre mensajes. Se
guarda el `ocurrido_en` del último evento aplicado y uno más viejo no pisa:
una `actualizada` de ayer que llega después de la `estado_cambiado` de hoy no
puede resucitar una suscripción cancelada.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction

from shared.borrado.bloqueo import bloquear_organizacion

from .models import SuscripcionVigilada

log = logging.getLogger(__name__)

EVENTOS_QUE_ESCUCHA = (
    "suscripcion.creada",
    "suscripcion.actualizada",
    "suscripcion.estado_cambiado",
)


class SobreInvalido(ValueError):
    """El evento no cumple el formato común del catálogo."""


def _uuid(valor, campo: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(valor))
    except (ValueError, TypeError, AttributeError):
        raise SobreInvalido(f"`{campo}` no es un UUID: {valor!r}") from None


def _instante(valor, campo: str) -> dt.datetime:
    texto = str(valor or "")
    if texto.endswith("Z"):
        texto = texto[:-1] + "+00:00"
    try:
        instante = dt.datetime.fromisoformat(texto)
    except ValueError:
        raise SobreInvalido(f"`{campo}` no es un instante ISO: {valor!r}") from None
    if instante.tzinfo is None:
        raise SobreInvalido(f"`{campo}` viene sin zona horaria: {valor!r}")
    return instante


def _fecha(valor, campo: str, *, opcional: bool = False) -> dt.date | None:
    if valor in (None, "") and opcional:
        return None
    try:
        return dt.date.fromisoformat(str(valor))
    except (ValueError, TypeError):
        raise SobreInvalido(f"`{campo}` no es una fecha ISO: {valor!r}") from None


def _monto(valor) -> Decimal:
    try:
        return Decimal(str(valor))
    except (InvalidOperation, ValueError, TypeError):
        raise SobreInvalido(f"`datos.monto` no es un decimal: {valor!r}") from None


#: Los ciclos que el contrato admite. Validar contra la lista y no recortar a
#: 10 caracteres: `"mensualmente"` recortado daba `"mensualmen"`, que no es un
#: ciclo y se guardaba igual.
CICLOS = frozenset({"mensual", "anual"})

_MONEDA = re.compile(r"^[A-Z]{3}$")


def _obligatorio(valor, campo: str):
    """Exige que el campo venga. None y cadena vacía son lo mismo acá."""
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        raise SobreInvalido(f"falta `{campo}`, que MX-21 v2 declara obligatorio")
    return valor


def _texto_obligatorio(valor, campo: str, largo: int) -> str:
    return str(_obligatorio(valor, campo))[:largo]


def _moneda(valor) -> str:
    """Tres letras mayúsculas, como pide el contrato.

    Antes se recortaba a 3 caracteres, así que `"pesos"` quedaba en `"pes"` y
    se guardaba como si fuera una moneda.
    """
    crudo = str(_obligatorio(valor, "datos.moneda"))
    if not _MONEDA.match(crudo):
        raise SobreInvalido(f"`datos.moneda` no es un codigo de 3 letras: {crudo!r}")
    return crudo


def _ciclo(valor) -> str:
    crudo = str(_obligatorio(valor, "datos.ciclo"))
    if crudo not in CICLOS:
        raise SobreInvalido(
            f"`datos.ciclo` debe ser uno de {sorted(CICLOS)}, no {crudo!r}"
        )
    return crudo


def aplicar(sobre: dict) -> bool:
    """Aplica un evento a la proyección. True si cambió algo.

    False significa una de dos cosas, y las dos son normales: el evento no es
    de los que escuchamos, o es más viejo que lo que ya se sabía.
    """
    if not isinstance(sobre, dict):
        raise SobreInvalido("El sobre no es un objeto JSON.")
    nombre = sobre.get("evento")
    if nombre not in EVENTOS_QUE_ESCUCHA:
        return False

    # Regla 4 del catálogo: el tenant viaja en el evento. Sin él no se sabe
    # de quién es la suscripción, y meterla en otra organización es peor que
    # descartar el mensaje.
    organizacion_id = _uuid(sobre.get("organizacion_id"), "organizacion_id")
    ocurrido_en = _instante(sobre.get("ocurrido_en"), "ocurrido_en")
    datos = sobre.get("datos") or {}
    if not isinstance(datos, dict):
        raise SobreInvalido("`datos` no es un objeto.")

    # ── Lo que el contrato exige NO se inventa ──────────────────────────────
    # La versión anterior asumía monto="0.00", moneda="CLP" y ciclo="mensual",
    # y trataba `proximo_cobro` como opcional, aunque MX-21 v2 los declara
    # OBLIGATORIOS. Un sobre incompleto producía una alerta de "0 CLP" en vez
    # de rechazarse, y el usuario recibía un aviso de un cobro que nadie sabe
    # cuánto es. Lo encontró la revisión de la PR.
    #
    # Ahora faltan → `SobreInvalido`, que el consumidor aparta a la cola de
    # fallos: un productor mal implementado se ve, no se maquilla.
    valores = {
        "nombre": _texto_obligatorio(datos.get("nombre"), "datos.nombre", 120),
        "monto": _monto(_obligatorio(datos.get("monto"), "datos.monto")),
        "moneda": _moneda(datos.get("moneda")),
        "ciclo": _ciclo(datos.get("ciclo")),
        # `_obligatorio` primero para que el motivo diga "falta el campo" y no
        # "no es una fecha ISO: None", que manda a buscar el error al lugar
        # equivocado.
        "proximo_cobro": _fecha(
            _obligatorio(datos.get("proximo_cobro"), "datos.proximo_cobro"),
            "datos.proximo_cobro",
        ),
        "estado": _texto_obligatorio(datos.get("estado"), "datos.estado", 20),
        # Extensión del contrato: si el sobre la trae, se guarda; si no, NULL.
        "fin_prueba": _fecha(datos.get("fin_prueba"), "datos.fin_prueba", opcional=True),
        "observada_en": ocurrido_en,
    }
    if not valores["estado"]:
        raise SobreInvalido("`datos.estado` es obligatorio.")
    suscripcion_id = _uuid(datos.get("suscripcion_id"), "datos.suscripcion_id")

    with transaction.atomic():
        # ── Una organización eliminada no recibe filas nuevas (MX-07) ───────
        # RabbitMQ entrega AL MENOS una vez, así que un evento puede llegar
        # después de que la limpieza confirmó el 204. Sin esta guarda,
        # `get_or_create` lo volvía a escribir: nombre, monto y fecha de
        # cobro reaparecían en un tenant borrado, y el generador creaba
        # alertas desde esa fila resucitada. Lo encontró la revisión de la PR
        # al integrar con #72.
        #
        # `compartido=True` toma FOR SHARE: dos eventos de la misma
        # organización siguen entrando en paralelo, y la limpieza —que toma
        # FOR UPDATE— espera a que esta transacción cierre. El orden de
        # bloqueos es el mismo que usa la limpieza (estado y después los
        # datos), así que no se cruzan.
        if bloquear_organizacion(organizacion_id, compartido=True).eliminada:
            # No es `SobreInvalido`: el evento está bien formado, lo que no
            # existe es el destinatario. Mandarlo a la cola de fallidos lo
            # dejaría ahí para siempre; descartarlo es lo correcto.
            log.info(
                "evento %s de %s descartado: la organización %s fue eliminada",
                nombre, suscripcion_id, organizacion_id,
            )
            return False

        fila, creada = SuscripcionVigilada.objects.get_or_create(
            organizacion_id=organizacion_id,
            suscripcion_id=suscripcion_id,
            defaults=valores,
        )
        if creada:
            return True
        # ── Un evento más viejo no pisa uno más nuevo ───────────────────────
        # La condición va en el WHERE: dos consumidores con el mismo mensaje
        # no pueden pasar los dos una comparación hecha en memoria.
        cambiadas = SuscripcionVigilada.objects.filter(
            pk=fila.pk, observada_en__lt=ocurrido_en
        ).update(**valores)
        if not cambiadas:
            log.info(
                "evento %s de %s ignorado: la proyección ya tiene uno de %s o más nuevo",
                nombre, suscripcion_id, ocurrido_en.isoformat(),
            )
        return bool(cambiadas)

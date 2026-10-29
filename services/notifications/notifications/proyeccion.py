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
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction

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

    valores = {
        "nombre": str(datos.get("nombre") or "")[:120],
        "monto": _monto(datos.get("monto", "0.00")),
        "moneda": str(datos.get("moneda") or "CLP")[:3],
        "ciclo": str(datos.get("ciclo") or "mensual")[:10],
        "proximo_cobro": _fecha(datos.get("proximo_cobro"), "datos.proximo_cobro", opcional=True),
        "estado": str(datos.get("estado") or "")[:20],
        # Extensión del contrato: si el sobre la trae, se guarda; si no, NULL.
        "fin_prueba": _fecha(datos.get("fin_prueba"), "datos.fin_prueba", opcional=True),
        "observada_en": ocurrido_en,
    }
    if not valores["estado"]:
        raise SobreInvalido("`datos.estado` es obligatorio.")
    suscripcion_id = _uuid(datos.get("suscripcion_id"), "datos.suscripcion_id")

    with transaction.atomic():
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

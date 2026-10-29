"""Detección de anomalías de cobro (VI-19 / RF-07 / CU-30).

Reglas implementadas, tomadas de RF-07 y de la tarjeta VI-19:

* **Alza de tarifa**: el monto del cobro nuevo supera en *más de* 5 % el
  promedio de los últimos 3 meses del mismo servicio. Se necesitan al menos
  2 cobros previos; el primer cobro (o el segundo) nunca genera un alza.
  El umbral es estricto: 10.000 → 10.500 no alerta, 10.000 → 10.600 sí.
* **Posible doble cobro**: hay otro cobro del mismo servicio a menos de 5
  días. El límite también es estricto: día 1 y día 5 alertan (4 días de
  diferencia), día 1 y día 6 no (5 días).

La detección se ejecuta automáticamente al crear un :class:`~app.models.Cobro`
(señal ``post_save``) y también puede invocarse de forma explícita desde una
importación o un comando. Los hallazgos se persisten con una clave de
deduplicación por tenant, de modo que reprocesar el mismo cobro no duplica
alertas.

Este módulo no cambia el estado de la suscripción: una alerta es evidencia
para el usuario, no una transición de la máquina de estados.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.utils import timezone

from app.models import Cobro, HallazgoCobro


# ── parámetros de negocio ────────────────────────────────────────────

UMBRAL_ALZA = Decimal("0.05")
MESES_PROMEDIO = 3
MIN_COBROS_PREVIOS = 2
DIAS_DOBLE_COBRO = 5
MONTO_CERO = Decimal("0.00")


# ── utilidades ───────────────────────────────────────────────────────


def _restar_meses(fecha: date, meses: int) -> date:
    """Resta meses calendario conservando el día cuando existe.

    Si el día no existe en el mes destino (31 de mayo − 3 meses), se usa el
    último día de ese mes (28/29 de febrero). No se usan bloques fijos de 30
    días para que el borde de la ventana coincida con lo que un usuario
    entiende por "los últimos 3 meses".
    """
    indice = fecha.year * 12 + fecha.month - 1 - meses
    anio, mes_base = divmod(indice, 12)
    mes = mes_base + 1
    dia = min(fecha.day, monthrange(anio, mes)[1])
    return date(anio, mes, dia)


def _promedio(montos: list[Decimal]) -> Decimal:
    if not montos:
        return MONTO_CERO
    return (sum(montos, MONTO_CERO) / Decimal(len(montos))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def _cobros_previos(cobro: Cobro) -> list[Cobro]:
    """Cobros del mismo servicio y **misma moneda** anteriores al cobro.

    Se ordenan del más reciente al más antiguo y se usan como máximo 3. La
    suscripción representa al servicio: los cargos de otra suscripción no
    entran en el promedio aunque compartan nombre, para no mezclar planes.

    La moneda es parte de la comparabilidad: sin una tasa de cambio no se
    puede comparar un importe en CLP con uno en USD. Un antecedente en otra
    moneda no cuenta para el mínimo de evidencia ni entra en el promedio.
    """
    desde = _restar_meses(cobro.fecha, MESES_PROMEDIO)
    return list(
        Cobro.objects.filter(
            organizacion_id=cobro.organizacion_id,
            suscripcion_id=cobro.suscripcion_id,
            moneda=cobro.moneda,
            fecha__gte=desde,
            fecha__lt=cobro.fecha,
        )
        .order_by("-fecha", "-id")[:3]
    )


# ── evaluación pura (sin persistencia) ───────────────────────────────


def evaluar_alza_tarifa(cobro: Cobro) -> dict[str, Any] | None:
    """Devuelve la evidencia del alza o ``None`` si no corresponde alertar.

    No escribe en la base. Es la pieza que se puede probar con un cobro
    construido en memoria, sin depender de la señal ni de la tabla de
    hallazgos.
    """
    previos = _cobros_previos(cobro)
    if len(previos) < MIN_COBROS_PREVIOS:
        return None

    montos = [previo.monto for previo in previos]
    promedio = _promedio(montos)
    if promedio <= MONTO_CERO:
        return None

    umbral = (promedio * (Decimal("1") + UMBRAL_ALZA)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    # Estricto: igualar el umbral (exactamente +5 %) no es un alza.
    if cobro.monto <= umbral:
        return None

    variacion = (
        ((cobro.monto - promedio) / promedio) * Decimal("100")
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return {
        "promedio": promedio,
        "umbral": umbral,
        "porcentaje_variacion": variacion,
        "cantidad_previos": len(previos),
        "cobros_previos": [
            {
                "id": str(previo.id),
                "fecha": previo.fecha.isoformat(),
                "monto": str(previo.monto),
            }
            for previo in previos
        ],
    }


def evaluar_doble_cobro(cobro: Cobro) -> dict[str, Any] | None:
    """Busca otro cobro del mismo servicio a menos de 5 días.

    Devuelve el candidato más cercano (y, a igual distancia, el de menor
    fecha/id) o ``None``. No escribe en la base.
    """
    margen = timedelta(days=DIAS_DOBLE_COBRO - 1)
    candidatos = (
        Cobro.objects.filter(
            organizacion_id=cobro.organizacion_id,
            suscripcion_id=cobro.suscripcion_id,
            fecha__range=(cobro.fecha - margen, cobro.fecha + margen),
        )
        .exclude(pk=cobro.pk)
    )

    mejor: tuple[int, date, str, Cobro] | None = None
    for candidato in candidatos:
        diferencia = abs((candidato.fecha - cobro.fecha).days)
        # Estricto: 5 días de diferencia ya no es "menos de 5 días".
        if diferencia >= DIAS_DOBLE_COBRO:
            continue
        clave = (diferencia, candidato.fecha, str(candidato.id), candidato)
        if mejor is None or clave[:3] < mejor[:3]:
            mejor = clave

    if mejor is None:
        return None

    relacionado = mejor[3]
    return {
        "cobro_relacionado": relacionado,
        "dias_diferencia": mejor[0],
        "fecha_relacionada": relacionado.fecha,
        "monto_relacionado": relacionado.monto,
    }


# ── persistencia de hallazgos ────────────────────────────────────────


def _clave_alza(cobro: Cobro) -> str:
    return f"alza:{cobro.pk}"


def _clave_doble(primero: Cobro, segundo: Cobro) -> str:
    ids = sorted((str(primero.pk), str(segundo.pk)))
    return f"doble:{ids[0]}:{ids[1]}"


def _persistir(
    *,
    cobro: Cobro,
    tipo: str,
    clave: str,
    monto_referencia: Decimal | None,
    porcentaje_variacion: Decimal | None,
    cobro_relacionado: Cobro | None,
    fecha_referencia: date | None,
    detalle: dict[str, Any],
) -> tuple[HallazgoCobro, bool]:
    return HallazgoCobro.objects.get_or_create(
        organizacion_id=cobro.organizacion_id,
        clave_deduplicacion=clave,
        defaults={
            "tipo": tipo,
            "suscripcion_id": cobro.suscripcion_id,
            "cobro_id": cobro.pk,
            "cobro_relacionado_id": cobro_relacionado.pk if cobro_relacionado else None,
            "monto": cobro.monto,
            "monto_referencia": monto_referencia,
            "moneda": cobro.moneda,
            "porcentaje_variacion": porcentaje_variacion,
            "fecha_cobro": cobro.fecha,
            "fecha_referencia": fecha_referencia,
            "detalle": detalle,
        },
    )


def detectar_anomalias_cobro(cobro: Cobro) -> list[HallazgoCobro]:
    """Analiza un cobro y persiste los hallazgos que correspondan.

    Es idempotente: la clave única por tenant evita duplicados si la misma
    importación se reprocesa. Devuelve los hallazgos vigentes para ese cobro
    (creados ahora o ya existentes), ordenados por tipo.
    """
    if cobro.pk is None:
        raise ValueError("El cobro debe estar persistido antes de analizarlo.")

    hallazgos: list[HallazgoCobro] = []
    with transaction.atomic():
        alza = evaluar_alza_tarifa(cobro)
        if alza is not None:
            hallazgo, _ = _persistir(
                cobro=cobro,
                tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
                clave=_clave_alza(cobro),
                monto_referencia=alza["promedio"],
                porcentaje_variacion=alza["porcentaje_variacion"],
                cobro_relacionado=None,
                fecha_referencia=None,
                detalle={
                    "promedio": str(alza["promedio"]),
                    "umbral": str(alza["umbral"]),
                    "cantidad_previos": alza["cantidad_previos"],
                    "cobros_previos": alza["cobros_previos"],
                },
            )
            hallazgos.append(hallazgo)

        doble = evaluar_doble_cobro(cobro)
        if doble is not None:
            relacionado: Cobro = doble["cobro_relacionado"]
            hallazgo, _ = _persistir(
                cobro=cobro,
                tipo=HallazgoCobro.Tipo.DOBLE_COBRO,
                clave=_clave_doble(cobro, relacionado),
                monto_referencia=doble["monto_relacionado"],
                porcentaje_variacion=None,
                cobro_relacionado=relacionado,
                fecha_referencia=doble["fecha_relacionada"],
                detalle={"dias_diferencia": doble["dias_diferencia"]},
            )
            hallazgos.append(hallazgo)

    return hallazgos


# Alias corto para consumidores que ya hablan de "anomalías" (RF-07).
def detectar_anomalias(cobro: Cobro) -> list[HallazgoCobro]:
    return detectar_anomalias_cobro(cobro)


def marcar_hallazgo_revisado(
    hallazgo: HallazgoCobro,
    *,
    usuario_id: int | None = None,
    cuando=None,
) -> HallazgoCobro:
    """Marca una alerta como revisada sin tocar el estado de la suscripción."""
    if hallazgo.estado == HallazgoCobro.Estado.REVISADA:
        return hallazgo

    hallazgo.estado = HallazgoCobro.Estado.REVISADA
    hallazgo.revisado_en = cuando or timezone.now()
    hallazgo.revisado_por = usuario_id
    hallazgo.save(
        update_fields=("estado", "revisado_en", "revisado_por", "actualizado_en")
    )
    return hallazgo

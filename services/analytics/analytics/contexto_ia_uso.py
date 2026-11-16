"""Constructor puro de contexto del asistente (S3-VI-19..S3-VI-22).

No accede a base de datos ni red. Recibe datos ya cargados y sanitizados en
origen (solo organización autenticada) y arma un contexto estructurado con:
- suscripciones activas,
- uso real acumulado con unidades explícitas,
- estado de cobertura (`completa`, `parcial`, `sin_medicion`),
- fecha de última actividad positiva real,
- gastos agrupados estrictamente por moneda (sin mezclar divisas).

Si la consulta de Analytics falla, la capa de acceso a datos debe señalizar
degradación; este módulo puede representar ese estado sin inventar "0 minutos".
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Iterable, Mapping, Sequence

CENTAVO = Decimal("0.01")


@dataclass(frozen=True)
class SuscripcionActivaContexto:
    suscripcion_id: str
    nombre: str
    estado: str
    moneda: str
    monto_mensual_texto: str


@dataclass(frozen=True)
class UsoRecolectadoContexto:
    suscripcion_id: str
    nombre: str
    duracion_positiva_ms: int
    minutos_enteros_proyectados: int
    unidad_duracion_ms: str
    unidad_minutos_enteros: str
    cobertura: str
    certeza: str
    clasificacion_uso: str
    fecha_ultima_actividad_positiva: str | None


@dataclass(frozen=True)
class GastoPorMoneda:
    moneda: str
    total_mensual_texto: str
    cantidad_suscripciones_activas: int


def _normalizar_monto_texto(valor: object) -> str:
    try:
        monto = Decimal(str(valor))
    except (InvalidOperation, ValueError, TypeError):
        monto = Decimal("0.00")
    return str(monto.quantize(CENTAVO, rounding=ROUND_HALF_UP))


def agrupar_gastos_por_moneda(
    suscripciones: Iterable[SuscripcionActivaContexto],
) -> list[GastoPorMoneda]:
    """Agrupa gastos mensuales estrictamente por moneda, sin mezclar divisas."""
    acumulados: dict[str, tuple[Decimal, int]] = {}
    for suscripcion in suscripciones:
        moneda = (suscripcion.moneda or "").strip().upper()
        if not moneda:
            continue
        try:
            monto = Decimal(suscripcion.monto_mensual_texto)
        except (InvalidOperation, ValueError, TypeError):
            monto = Decimal("0.00")
        total_actual, cantidad_actual = acumulados.get(moneda, (Decimal("0.00"), 0))
        acumulados[moneda] = (total_actual + monto, cantidad_actual + 1)

    resultado: list[GastoPorMoneda] = []
    for moneda in sorted(acumulados):
        total, cantidad = acumulados[moneda]
        resultado.append(
            GastoPorMoneda(
                moneda=moneda,
                total_mensual_texto=str(total.quantize(CENTAVO, rounding=ROUND_HALF_UP)),
                cantidad_suscripciones_activas=cantidad,
            )
        )
    return resultado


def construir_contexto_ia_puro(
    *,
    suscripciones_activas: Sequence[SuscripcionActivaContexto],
    usos_recolectados: Sequence[UsoRecolectadoContexto],
    consulta_uso_disponible: bool,
    motivo_consulta_uso_no_disponible: str | None = None,
) -> dict[str, object]:
    """Construye el contexto interno (previo a sanitización para proveedor).

    Cuando `consulta_uso_disponible` es False no se incluyen métricas inventadas
    de "0 minutos"; se marca explícitamente el estado degradado de la consulta.
    """
    suscripciones = [
        {
            "nombre": s.nombre,
            "estado": s.estado,
            "moneda": s.moneda,
            "monto_mensual": _normalizar_monto_texto(s.monto_mensual_texto),
        }
        for s in suscripciones_activas
    ]

    uso_mensual_recolector: list[dict[str, object]] = []
    if consulta_uso_disponible:
        for uso in usos_recolectados:
            uso_mensual_recolector.append(
                {
                    "nombre": uso.nombre,
                    "duracion_positiva_ms": int(uso.duracion_positiva_ms),
                    "unidad_duracion": uso.unidad_duracion_ms or "ms",
                    "minutos_enteros_proyectados": int(uso.minutos_enteros_proyectados),
                    "unidad_minutos_enteros": uso.unidad_minutos_enteros or "min",
                    "cobertura": uso.cobertura,
                    "certeza": uso.certeza,
                    "clasificacion_uso": uso.clasificacion_uso,
                    "fecha_ultima_actividad_positiva": uso.fecha_ultima_actividad_positiva,
                }
            )

    contexto: dict[str, object] = {
        "suscripciones_activas": suscripciones,
        "gastos_mensuales_por_moneda": [
            asdict(g) for g in agrupar_gastos_por_moneda(suscripciones_activas)
        ],
        "uso_recolectores": {
            "disponible": bool(consulta_uso_disponible),
            "motivo_no_disponible": None if consulta_uso_disponible else (motivo_consulta_uso_no_disponible or "consulta_no_disponible"),
            "periodicidad": "mensual",
            "registros": uso_mensual_recolector,
            "nota_semantica": (
                "Una duracion_positiva_ms mayor que 0 es uso positivo confirmado aunque "
                "minutos_enteros_proyectados sea 0. Cero observado solo aplica con "
                "cobertura completa, estado activo y sin actividad en la ventana."
            ),
        },
    }
    return contexto

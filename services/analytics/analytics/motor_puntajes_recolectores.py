"""Motor puro de puntajes y reglas de recomendación sobre `uso-recolectores-v1` (S3-VI-16..S3-VI-18).

Este módulo NO accede a base de datos ni a ORM. Recibe evidencia ya cargada y
devuelve resultados deterministas.

Semántica contractual (uso-recolectores-v1):
- Uso positivo confirmado: `duracion_ms > 0` o evidencia positiva en tramos.
  Una actividad de 30000 ms (30 s) proyectada a 0 minutos enteros SIGUE siendo
  uso positivo; nunca se clasifica como uso cero ni inactividad.
- Cero observado: únicamente con `cobertura == "completa"`, `estado == "activo"`
  y sin actividad (`duracion_ms == 0` / tramos vacíos) en la ventana evaluada.
- Datos insuficientes / ausencia de medición: `cobertura` en
  `"sin_medicion"` o `"parcial"` sin actividad, `estado` en
  `"pausado" | "sin_permiso" | "revocado"`, o silencio posterior al último
  intervalo confirmado.

Protección: los períodos sin medición no bajan el aprovechamiento ni disparan
recomendaciones automáticas de cancelación/reducción por "bajo uso".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Constantes documentadas de umbrales y clasificación
# ---------------------------------------------------------------------------

# Umbral mínimo de milisegundos observados en la ventana para considerar que
# hubo aprovechamiento "normal" (referencia para puntaje continuo). No convierte
# 30 s en cero: cualquier duracion_positiva_ms > 0 ya es uso positivo.
UMBRAL_APROVECHAMIENTO_NORMAL_MS: int = 60 * 60 * 1000  # 60 minutos

# Umbral de aprovechamiento bajo confirmado (evidencia completa/activa con
# actividad positiva, pero muy escasa) expresado en milisegundos.
UMBRAL_APROVECHAMIENTO_BAJO_MS: int = 10 * 60 * 1000  # 10 minutos

# Puntajes de referencia (0-100). Se exponen junto a la certeza/cobertura para
# que la interfaz distinga "bajo uso comprobado" de "cobertura insuficiente".
PUNTAJE_MAXIMO_APROVECHAMIENTO: int = 100
PUNTAJE_BAJO_USO_COMPROBADO: int = 20
PUNTAJE_CERO_OBSERVADO_COMPLETO: int = 0
PUNTAJE_DATOS_INSUFICIENTES: int = 0  # valor neutro: NO significa bajo uso

CLASIFICACION_USO_POSITIVO = "uso_positivo_confirmado"
CLASIFICACION_CERO_OBSERVADO = "cero_observado"
CLASIFICACION_DATOS_INSUFICIENTES = "datos_insuficientes"

CERTEZA_ALTA = "alta"
CERTEZA_MEDIA = "media"
CERTEZA_INSUFICIENTE = "insuficiente"

COBERTURA_COMPLETA = "completa"
COBERTURA_PARCIAL = "parcial"
COBERTURA_SIN_MEDICION = "sin_medicion"

ESTADO_ACTIVO = "activo"
ESTADO_PAUSADO = "pausado"
ESTADO_SIN_PERMISO = "sin_permiso"
ESTADO_REVOCADO = "revocado"

MOTIVO_BAJO_USO_COMPROBADO = "bajo_uso_comprobado"
MOTIVO_CERO_OBSERVADO_COMPLETO = "cero_observado_con_cobertura_completa"
MOTIVO_COBERTURA_INSUFICIENTE = "cobertura_insuficiente"
MOTIVO_SIN_MEDICION = "sin_medicion"
MOTIVO_RECOLECTOR_PAUSADO = "recolector_pausado"
MOTIVO_SIN_PERMISO = "recolector_sin_permiso"
MOTIVO_REVOCADO = "recolector_revocado"
MOTIVO_SILENCIO_POSTERIOR = "silencio_posterior_a_intervalo_confirmado"

ACCION_RECOMENDAR_CANCELACION = "recomendar_cancelacion"
ACCION_RECOMENDAR_REDUCCION = "recomendar_reduccion_plan"
ACCION_SIN_RECOMENDACION_AUTOMATICA = "sin_recomendacion_automatica"


@dataclass(frozen=True)
class EvidenciaUsoVentana:
    """Evidencia agregada de uso recolectado en una ventana de evaluación.

    Todos los campos deben provenir de datos ya consolidados/cargados en lote;
    este objeto no consulta almacenamiento.
    """

    suscripcion_id: str
    duracion_positiva_ms: int
    # Cobertura/estado observados más relevantes en la ventana (derivados de
    # uso_cobertura/uso_evento). `cobertura_predominante` resume la calidad de
    # medición disponible para interpretar la ausencia/presencia de actividad.
    cobertura_predominante: str
    estado_predominante: str
    # True si existe al menos un intervalo/evento con cobertura completa+activo
    # que acredita observación explícita en la ventana.
    existe_observacion_completa_activa: bool
    # True si hay indicios de medición parcial/sin_medicion o silencio posterior
    # al último intervalo confirmado (ausencia de evidencia concluyente).
    existe_brecha_de_medicion: bool
    fecha_ultima_actividad_positiva: date | None
    # Fecha/hora no necesaria en pureza; la fecha local última positiva basta
    # para contexto y para detectar silencio relativo en la carga superior.
    minutos_enteros_proyectados: int


@dataclass(frozen=True)
class ResultadoPuntajeAprovechamiento:
    suscripcion_id: str
    clasificacion_uso: str
    puntaje_aprovechamiento: int
    certeza: str
    cobertura: str
    motivo: str
    duracion_positiva_ms: int
    minutos_enteros_proyectados: int
    # True solo cuando la evidencia permite afirmar bajo uso/cero observado sin
    # ambigüedad de medición. False implica que no debe penalizarse.
    permite_penalizacion_por_bajo_uso: bool


@dataclass(frozen=True)
class ResultadoReglaRecomendacion:
    suscripcion_id: str
    accion: str
    motivo: str
    clasificacion_uso: str
    certeza: str
    cobertura: str
    # El motor nunca recomienda cancelación/reducción por falta de medición.
    penalizacion_aplicada: bool


def _normalizar_cobertura(valor: str | None) -> str:
    if valor in {COBERTURA_COMPLETA, COBERTURA_PARCIAL, COBERTURA_SIN_MEDICION}:
        return valor
    return COBERTURA_SIN_MEDICION


def _normalizar_estado(valor: str | None) -> str:
    if valor in {ESTADO_ACTIVO, ESTADO_PAUSADO, ESTADO_SIN_PERMISO, ESTADO_REVOCADO}:
        return valor
    return ESTADO_PAUSADO


def clasificar_uso_ventana(evidencia: EvidenciaUsoVentana) -> tuple[str, str, str, bool]:
    """Clasifica uso y certeza a partir de evidencia de ventana.

    Retorna (clasificacion_uso, certeza, motivo, permite_penalizacion).
    """
    cobertura = _normalizar_cobertura(evidencia.cobertura_predominante)
    estado = _normalizar_estado(evidencia.estado_predominante)
    duracion_ms = max(0, int(evidencia.duracion_positiva_ms))

    # 1) Uso positivo confirmado: cualquier duracion_ms > 0 es positivo, incluso
    # si la proyección a minutos enteros es 0 (p.ej. 30000 ms).
    if duracion_ms > 0:
        certeza = (
            CERTEZA_ALTA
            if cobertura == COBERTURA_COMPLETA and estado == ESTADO_ACTIVO and not evidencia.existe_brecha_de_medicion
            else CERTEZA_MEDIA
        )
        # Si hay brechas o estados no activos, no es "cero"/penalizable por bajo
        # uso extremo más allá de lo observado; la positividad sigue siendo real.
        return (CLASIFICACION_USO_POSITIVO, certeza, "uso_positivo_confirmado", False)

    # 2) Estados/coberturas que implican ausencia de medición concluyente -> no
    # penalizar y no afirmar uso cero.
    if estado == ESTADO_PAUSADO:
        return (CLASIFICACION_DATOS_INSUFICIENTES, CERTEZA_INSUFICIENTE, MOTIVO_RECOLECTOR_PAUSADO, False)
    if estado == ESTADO_SIN_PERMISO:
        return (CLASIFICACION_DATOS_INSUFICIENTES, CERTEZA_INSUFICIENTE, MOTIVO_SIN_PERMISO, False)
    if estado == ESTADO_REVOCADO:
        return (CLASIFICACION_DATOS_INSUFICIENTES, CERTEZA_INSUFICIENTE, MOTIVO_REVOCADO, False)
    if cobertura == COBERTURA_SIN_MEDICION:
        return (CLASIFICACION_DATOS_INSUFICIENTES, CERTEZA_INSUFICIENTE, MOTIVO_SIN_MEDICION, False)
    if evidencia.existe_brecha_de_medicion:
        return (CLASIFICACION_DATOS_INSUFICIENTES, CERTEZA_INSUFICIENTE, MOTIVO_COBERTURA_INSUFICIENTE, False)
    if cobertura == COBERTURA_PARCIAL:
        # Parcial sin actividad no es cero observado concluyente.
        return (CLASIFICACION_DATOS_INSUFICIENTES, CERTEZA_INSUFICIENTE, MOTIVO_COBERTURA_INSUFICIENTE, False)

    # 3) Cero observado: solo cobertura completa + activo + sin actividad en la
    # ventana evaluada.
    if cobertura == COBERTURA_COMPLETA and estado == ESTADO_ACTIVO and evidencia.existe_observacion_completa_activa:
        return (CLASIFICACION_CERO_OBSERVADO, CERTEZA_ALTA, MOTIVO_CERO_OBSERVADO_COMPLETO, True)

    # 4) Silencio sin intervalo confirmado concluyente.
    return (CLASIFICACION_DATOS_INSUFICIENTES, CERTEZA_INSUFICIENTE, MOTIVO_SILENCIO_POSTERIOR, False)


def calcular_puntaje_aprovechamiento(evidencia: EvidenciaUsoVentana) -> ResultadoPuntajeAprovechamiento:
    """Calcula puntaje de aprovechamiento propagando certeza y cobertura.

    Nunca penaliza períodos sin medición: en datos insuficientes el puntaje es
    neutro (0) pero `permite_penalizacion_por_bajo_uso` es False y la
    clasificación/certeza/cobertura explicitan que no es "bajo uso comprobado".
    """
    clasificacion, certeza, motivo, permite_penalizacion = clasificar_uso_ventana(evidencia)
    cobertura = _normalizar_cobertura(evidencia.cobertura_predominante)
    duracion_ms = max(0, int(evidencia.duracion_positiva_ms))

    if clasificacion == CLASIFICACION_USO_POSITIVO:
        # Puntaje continuo acotado; cualquier positivo (>0 ms) queda por encima
        # del puntaje de cero observado.
        if duracion_ms >= UMBRAL_APROVECHAMIENTO_NORMAL_MS:
            puntaje = PUNTAJE_MAXIMO_APROVECHAMIENTO
        elif duracion_ms <= UMBRAL_APROVECHAMIENTO_BAJO_MS:
            # Escala suave desde "muy bajo pero positivo" hasta umbral bajo.
            proporcion = duracion_ms / max(1, UMBRAL_APROVECHAMIENTO_BAJO_MS)
            puntaje = max(PUNTAJE_BAJO_USO_COMPROBADO, int(round(50 * proporcion)))
        else:
            tramo = duracion_ms - UMBRAL_APROVECHAMIENTO_BAJO_MS
            rango = max(1, UMBRAL_APROVECHAMIENTO_NORMAL_MS - UMBRAL_APROVECHAMIENTO_BAJO_MS)
            proporcion = tramo / rango
            puntaje = 50 + int(round(50 * proporcion))
        # Bajo uso comprobado solo cuando hay evidencia completa/activa, sin
        # brechas de medición, y al menos 1 minuto entero observado; duraciones
        # sub-minuto (p.ej. 30 s) son uso positivo confirmado pero no deben
        # disparar reducción automática.
        permite_penalizacion = (
            60_000 <= duracion_ms < UMBRAL_APROVECHAMIENTO_BAJO_MS
            and cobertura == COBERTURA_COMPLETA
            and certeza == CERTEZA_ALTA
            and not evidencia.existe_brecha_de_medicion
        )
        if permite_penalizacion:
            motivo = MOTIVO_BAJO_USO_COMPROBADO
    elif clasificacion == CLASIFICACION_CERO_OBSERVADO:
        puntaje = PUNTAJE_CERO_OBSERVADO_COMPLETO
        permite_penalizacion = True
    else:
        # Datos insuficientes: puntaje neutro, explícitamente no penalizable.
        puntaje = PUNTAJE_DATOS_INSUFICIENTES
        permite_penalizacion = False

    puntaje = max(0, min(PUNTAJE_MAXIMO_APROVECHAMIENTO, int(puntaje)))
    return ResultadoPuntajeAprovechamiento(
        suscripcion_id=evidencia.suscripcion_id,
        clasificacion_uso=clasificacion,
        puntaje_aprovechamiento=puntaje,
        certeza=certeza,
        cobertura=cobertura,
        motivo=motivo,
        duracion_positiva_ms=duracion_ms,
        minutos_enteros_proyectados=max(0, int(evidencia.minutos_enteros_proyectados)),
        permite_penalizacion_por_bajo_uso=permite_penalizacion,
    )


def evaluar_regla_recomendacion(resultado_puntaje: ResultadoPuntajeAprovechamiento) -> ResultadoReglaRecomendacion:
    """Deriva recomendación automática sin penalizar falta de medición.

    Solo recomienda cancelación/reducción cuando el bajo uso/cero observado está
    comprobado con evidencia suficiente (`permite_penalizacion_por_bajo_uso`).
    """
    if resultado_puntaje.permite_penalizacion_por_bajo_uso:
        accion = ACCION_RECOMENDAR_CANCELACION if resultado_puntaje.clasificacion_uso == CLASIFICACION_CERO_OBSERVADO else ACCION_RECOMENDAR_REDUCCION
        return ResultadoReglaRecomendacion(
            suscripcion_id=resultado_puntaje.suscripcion_id,
            accion=accion,
            motivo=resultado_puntaje.motivo,
            clasificacion_uso=resultado_puntaje.clasificacion_uso,
            certeza=resultado_puntaje.certeza,
            cobertura=resultado_puntaje.cobertura,
            penalizacion_aplicada=True,
        )

    return ResultadoReglaRecomendacion(
        suscripcion_id=resultado_puntaje.suscripcion_id,
        accion=ACCION_SIN_RECOMENDACION_AUTOMATICA,
        motivo=resultado_puntaje.motivo,
        clasificacion_uso=resultado_puntaje.clasificacion_uso,
        certeza=resultado_puntaje.certeza,
        cobertura=resultado_puntaje.cobertura,
        penalizacion_aplicada=False,
    )


def calcular_puntajes_y_recomendaciones(
    evidencias: Iterable[EvidenciaUsoVentana],
) -> list[dict[str, object]]:
    """Procesa un lote de evidencias y retorna puntaje+regla por suscripción."""
    resultados: list[dict[str, object]] = []
    for evidencia in evidencias:
        puntaje = calcular_puntaje_aprovechamiento(evidencia)
        recomendacion = evaluar_regla_recomendacion(puntaje)
        resultados.append({
            "suscripcion_id": evidencia.suscripcion_id,
            "clasificacion_uso": puntaje.clasificacion_uso,
            "puntaje_aprovechamiento": puntaje.puntaje_aprovechamiento,
            "certeza": puntaje.certeza,
            "cobertura": puntaje.cobertura,
            "motivo": puntaje.motivo,
            "duracion_positiva_ms": puntaje.duracion_positiva_ms,
            "minutos_enteros_proyectados": puntaje.minutos_enteros_proyectados,
            "permite_penalizacion_por_bajo_uso": puntaje.permite_penalizacion_por_bajo_uso,
            "recomendacion": {
                "accion": recomendacion.accion,
                "motivo": recomendacion.motivo,
                "penalizacion_aplicada": recomendacion.penalizacion_aplicada,
            },
        })
    return resultados

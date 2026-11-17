"""Consultas y ensamblado de evidencia de uso recolector (S3-VI-16..S3-VI-22).

Acceso a datos separado del cálculo puro. Todas las consultas filtran por
`organizacion_id` (aislamiento tenant). Carga en lote para evitar N+1.

Si una consulta falla, las excepciones de infraestructura deben propagarse o
marcar estado degradado en capas superiores; nunca se convierten en "0 minutos".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.db import DatabaseError, connection, transaction

from .motor_puntajes_recolectores import (
    COBERTURA_COMPLETA,
    COBERTURA_PARCIAL,
    COBERTURA_SIN_MEDICION,
    ESTADO_ACTIVO,
    ESTADO_PAUSADO,
    ESTADO_REVOCADO,
    ESTADO_SIN_PERMISO,
    EvidenciaUsoVentana,
)


class ConsultaUsoRecolectoresError(RuntimeError):
    """Fallo al consultar evidencia de uso recolector."""


@dataclass(frozen=True)
class SuscripcionActivaConGasto:
    suscripcion_id: str
    nombre: str
    monto_origen: str
    frecuencia: str
    monto_estimado_mensual: str
    tipo_gasto_estimado: str
    moneda: str
    estado: str
    activo: bool


@dataclass(frozen=True)
class UsoRecolectadoSuscripcion:
    suscripcion_id: str
    duracion_positiva_ms: int
    minutos_enteros_proyectados: int
    cobertura_predominante: str
    estado_predominante: str
    existe_observacion_completa_activa: bool
    existe_brecha_de_medicion: bool
    fecha_ultima_actividad_positiva: date | None


@dataclass(frozen=True)
class FilaCoberturaEvento:
    cobertura: str
    estado: str
    duracion_ms: int
    tramos_count: int
    fecha_local: date | None


@dataclass(frozen=True)
class IntervaloCoberturaObservado:
    inicio: datetime
    fin: datetime
    cobertura: str
    estado: str


def _adaptar_sql_para_sqlite(sql: str) -> str:
    # Compatibilidad básica para entorno de pruebas SQLite (sin schemas/casts PG).
    adaptado = sql
    adaptado = adaptado.replace("subscriptions.subscription", "subscription")
    adaptado = adaptado.replace("analytics.uso_mensual_recolector", "uso_mensual_recolector")
    adaptado = adaptado.replace("analytics.uso_evento", "uso_evento")
    adaptado = adaptado.replace("::text", "")
    adaptado = adaptado.replace("::bigint", "")
    adaptado = adaptado.replace("::int", "")
    adaptado = adaptado.replace("COALESCE(jsonb_array_length(tramos_actividad), 0)", "0")
    return adaptado


def _parsear_fecha_hora(valor: Any) -> datetime | None:
    if isinstance(valor, datetime):
        return valor if valor.tzinfo is not None else valor.replace(tzinfo=timezone.utc)
    if isinstance(valor, str):
        texto = valor.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(texto)
        except ValueError:
            return None
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    return None


def _ejecutar_consulta(sql: str, parametros: list[Any]) -> list[tuple[Any, ...]]:
    consulta = sql
    if connection.vendor == "sqlite":
        consulta = _adaptar_sql_para_sqlite(sql)
    try:
        # Savepoint para que un fallo (tabla/esquema ausente, etc.) no deje la
        # transacción PostgreSQL abortada y rompa el resto de la petición.
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(consulta, parametros)
                return list(cursor.fetchall())
    except DatabaseError as exc:
        raise ConsultaUsoRecolectoresError("No fue posible consultar evidencia de uso.") from exc


def _mes_a_rango(anio: int, mes: int) -> tuple[date, date]:
    inicio = date(anio, mes, 1)
    if mes == 12:
        fin = date(anio + 1, 1, 1)
    else:
        fin = date(anio, mes + 1, 1)
    return inicio, fin


def _monto_estimado_mensual(monto_texto: str, frecuencia: str) -> str:
    try:
        monto = Decimal(str(monto_texto or "0"))
    except (InvalidOperation, ValueError):
        monto = Decimal("0")
    frecuencia_norm = (frecuencia or "").strip().lower()
    if frecuencia_norm == "anual":
        monto = (monto / Decimal("12"))
    elif frecuencia_norm == "semanal":
        monto = (monto * Decimal("52") / Decimal("12"))
    elif frecuencia_norm == "quincenal":
        monto = (monto * Decimal("2"))
    # mensual y desconocida: se conserva como estimación base sin conversión adicional
    return str(monto.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def obtener_suscripciones_activas_con_gasto(organizacion_id: str) -> list[SuscripcionActivaConGasto]:
    """Obtiene suscripciones activas de la organización con monto, frecuencia y moneda.

    Usa `subscriptions.subscription` (schema compartido). El monto de la
    suscripción es el valor esperado por frecuencia (recurrente), no el cobro
    efectivamente realizado en un período: se normaliza a estimación mensual
    equivalente cuando corresponde, sin presentar un monto anual como mensual.
    """
    sql = """
        SELECT id::text, nombre, monto::text, COALESCE(frecuencia, 'mensual')::text, moneda, estado, activo
        FROM subscriptions.subscription
        WHERE organizacion_id = %s
          AND activo = TRUE
          AND estado IN ('prueba', 'activo', 'por_confirmar', 'fantasma')
        ORDER BY nombre, id
    """
    filas = _ejecutar_consulta(sql, [str(organizacion_id)])
    resultado: list[SuscripcionActivaConGasto] = []
    for fila in filas:
        monto_origen = str(fila[2] or "0")
        frecuencia = str(fila[3] or "mensual").lower()
        resultado.append(
            SuscripcionActivaConGasto(
                suscripcion_id=str(fila[0]),
                nombre=str(fila[1] or ""),
                monto_origen=monto_origen,
                frecuencia=frecuencia,
                monto_estimado_mensual=_monto_estimado_mensual(monto_origen, frecuencia),
                tipo_gasto_estimado="estimacion_recurrente_mensual_equivalente",
                moneda=str(fila[4] or "").upper(),
                estado=str(fila[5] or ""),
                activo=bool(fila[6]),
            )
        )
    return resultado


def _obtener_ultima_actividad_positiva_por_suscripcion(
    organizacion_id: str, suscripcion_ids: list[str]
) -> dict[str, date]:
    if not suscripcion_ids:
        return {}
    placeholders = ", ".join(["%s"] * len(suscripcion_ids))
    sql = f"""
        SELECT suscripcion_id::text, MAX(fecha_local) AS ultima_fecha_positiva
        FROM analytics.uso_evento
        WHERE organizacion_id = %s
          AND suscripcion_id::text IN ({placeholders})
          AND duracion_ms > 0
        GROUP BY suscripcion_id
    """
    filas = _ejecutar_consulta(sql, [str(organizacion_id), *suscripcion_ids])
    ultimas: dict[str, date] = {}
    for suscripcion_id, ultima_fecha in filas:
        if ultima_fecha is not None:
            ultimas[str(suscripcion_id)] = ultima_fecha
    return ultimas


def _union_intervalos(intervalos: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    if not intervalos:
        return []
    ordenados = sorted(intervalos, key=lambda item: item[0])
    unidos: list[tuple[datetime, datetime]] = [ordenados[0]]
    for inicio, fin in ordenados[1:]:
        ultimo_inicio, ultimo_fin = unidos[-1]
        if inicio <= ultimo_fin:
            if fin > ultimo_fin:
                unidos[-1] = (ultimo_inicio, fin)
        else:
            unidos.append((inicio, fin))
    return unidos


def _cubre_periodo_completo(
    intervalos: list[IntervaloCoberturaObservado],
    periodo_inicio: datetime,
    periodo_fin: datetime,
) -> bool:
    # Solo cuentan intervalos con medición reportada concluyente para cobertura
    # completa del tramo (completa + activo). Brechas/silencios fuera de ellos
    # impiden acreditar el período completo.
    concluyentes = [
        (max(i.inicio, periodo_inicio), min(i.fin, periodo_fin))
        for i in intervalos
        if i.cobertura == COBERTURA_COMPLETA and i.estado == ESTADO_ACTIVO and i.fin > periodo_inicio and i.inicio < periodo_fin
    ]
    concluyentes = [(a, b) for a, b in concluyentes if b > a]
    if not concluyentes:
        return False
    unidos = _union_intervalos(concluyentes)
    cursor = periodo_inicio
    for inicio, fin in unidos:
        if inicio > cursor:
            return False
        if fin > cursor:
            cursor = fin
        if cursor >= periodo_fin:
            return True
    return cursor >= periodo_fin


def _resumir_cobertura_y_estado(
    filas_cobertura: list[FilaCoberturaEvento],
    *,
    periodo_cubierto_completamente: bool | None = None,
) -> tuple[str, str, bool, bool]:
    """Deriva cobertura/estado predominantes y banderas de certeza.

    `filas_cobertura`: filas explícitas de evento/cobertura en la ventana.
    `periodo_cubierto_completamente`: si es False, existe brecha temporal (silencio)
    y no se puede acreditar cero observado del período completo.
    """
    if not filas_cobertura:
        return (COBERTURA_SIN_MEDICION, ESTADO_PAUSADO, False, True)

    hay_completa_activa = False
    hay_completa_activa_sin_actividad = False
    hay_sin_medicion = False
    hay_parcial = False
    hay_pausado = False
    hay_sin_permiso = False
    hay_revocado = False
    hay_activo = False

    for fila in filas_cobertura:
        cobertura_norm = str(fila.cobertura or "")
        estado_norm = str(fila.estado or "")
        dur = int(fila.duracion_ms or 0)
        tramos = int(fila.tramos_count or 0)

        if estado_norm == ESTADO_PAUSADO:
            hay_pausado = True
        elif estado_norm == ESTADO_SIN_PERMISO:
            hay_sin_permiso = True
        elif estado_norm == ESTADO_REVOCADO:
            hay_revocado = True
        elif estado_norm == ESTADO_ACTIVO:
            hay_activo = True

        if cobertura_norm == COBERTURA_SIN_MEDICION:
            hay_sin_medicion = True
        elif cobertura_norm == COBERTURA_PARCIAL:
            hay_parcial = True
        elif cobertura_norm == COBERTURA_COMPLETA and estado_norm == ESTADO_ACTIVO:
            hay_completa_activa = True
            if dur == 0 and tramos == 0:
                hay_completa_activa_sin_actividad = True

    # Prioridad de estados que impiden afirmar medición concluyente/cero observado.
    if hay_revocado:
        estado_predominante = ESTADO_REVOCADO
    elif hay_sin_permiso:
        estado_predominante = ESTADO_SIN_PERMISO
    elif hay_pausado and not hay_activo:
        estado_predominante = ESTADO_PAUSADO
    elif hay_activo:
        estado_predominante = ESTADO_ACTIVO
    else:
        estado_predominante = ESTADO_PAUSADO

    if hay_sin_medicion and not hay_completa_activa and not hay_parcial:
        cobertura_predominante = COBERTURA_SIN_MEDICION
    elif hay_parcial or (hay_sin_medicion and (hay_completa_activa or hay_parcial)):
        cobertura_predominante = COBERTURA_PARCIAL
    elif hay_completa_activa:
        cobertura_predominante = COBERTURA_COMPLETA
    else:
        cobertura_predominante = COBERTURA_SIN_MEDICION

    existe_observacion_completa_activa = hay_completa_activa_sin_actividad or (
        hay_completa_activa and estado_predominante == ESTADO_ACTIVO
    )
    # Brecha: mezcla de señales, sin medición, parcial, estados no activos,
    # o silencio/huecos temporales que impiden acreditar el período completo.
    existe_brecha = (
        hay_sin_medicion
        or hay_parcial
        or hay_pausado
        or hay_sin_permiso
        or hay_revocado
        or (hay_completa_activa and (hay_sin_medicion or hay_parcial or hay_pausado or hay_sin_permiso or hay_revocado))
    )
    if periodo_cubierto_completamente is False:
        existe_brecha = True
        existe_observacion_completa_activa = False
        if cobertura_predominante == COBERTURA_COMPLETA and estado_predominante == ESTADO_ACTIVO:
            # No hay evidencia concluyente del período completo: silencio no extiende cobertura.
            cobertura_predominante = COBERTURA_PARCIAL
    elif periodo_cubierto_completamente is True and existe_observacion_completa_activa:
        existe_observacion_completa_activa = True
    return (cobertura_predominante, estado_predominante, existe_observacion_completa_activa, existe_brecha)


def obtener_uso_recolectado_mensual(
    organizacion_id: str, anio: int, mes: int, suscripcion_ids: list[str] | None = None
) -> dict[str, UsoRecolectadoSuscripcion]:
    """Carga en lote uso recolectado del mes por suscripción.

    Combina `uso_mensual_recolector` (duración/minutos proyectados) con eventos
    de `uso_evento` para cobertura/estado y última actividad positiva.
    """
    parametros_base: list[Any] = [str(organizacion_id), int(anio), int(mes)]
    filtro_suscripciones = ""
    parametros_suscripciones: list[Any] = []
    if suscripcion_ids:
        placeholders = ", ".join(["%s"] * len(suscripcion_ids))
        filtro_suscripciones = f" AND suscripcion_id::text IN ({placeholders})"
        parametros_suscripciones = [str(s) for s in suscripcion_ids]

    sql_mensual = f"""
        SELECT suscripcion_id::text,
               COALESCE(ms_netos, 0)::bigint AS ms_netos,
               COALESCE(minutos_netos, 0)::int AS minutos_netos
        FROM analytics.uso_mensual_recolector
        WHERE organizacion_id = %s
          AND anio = %s
          AND mes = %s
          {filtro_suscripciones}
    """
    filas_mensual = _ejecutar_consulta(sql_mensual, parametros_base + parametros_suscripciones)

    inicio_rango, fin_rango = _mes_a_rango(int(anio), int(mes))
    sql_eventos = f"""
        SELECT suscripcion_id::text,
               cobertura,
               estado,
               COALESCE(duracion_ms, 0)::bigint AS duracion_ms,
               COALESCE(jsonb_array_length(tramos_actividad), 0)::int AS tramos_count,
               fecha_local,
               inicio,
               fin
        FROM analytics.uso_evento
        WHERE organizacion_id = %s
          AND fecha_local >= %s
          AND fecha_local < %s
          {filtro_suscripciones}
    """
    filas_eventos = _ejecutar_consulta(
        sql_eventos, [str(organizacion_id), inicio_rango, fin_rango] + parametros_suscripciones
    )

    mensual_por_suscripcion: dict[str, tuple[int, int]] = {}
    suscripciones_vistas: list[str] = []
    for suscripcion_id, ms_netos, minutos_netos in filas_mensual:
        sid = str(suscripcion_id)
        mensual_por_suscripcion[sid] = (int(ms_netos or 0), int(minutos_netos or 0))
        suscripciones_vistas.append(sid)

    eventos_por_suscripcion: dict[str, list[FilaCoberturaEvento]] = {}
    intervalos_por_suscripcion: dict[str, list[IntervaloCoberturaObservado]] = {}
    for fila in filas_eventos:
        sid = str(fila[0])
        eventos_por_suscripcion.setdefault(sid, []).append(
            FilaCoberturaEvento(
                cobertura=str(fila[1] or ""),
                estado=str(fila[2] or ""),
                duracion_ms=int(fila[3] or 0),
                tramos_count=int(fila[4] or 0),
                fecha_local=fila[5] if isinstance(fila[5], date) else None,
            )
        )
        inicio = _parsear_fecha_hora(fila[6])
        fin = _parsear_fecha_hora(fila[7])
        if inicio is not None and fin is not None and fin > inicio:
            intervalos_por_suscripcion.setdefault(sid, []).append(
                IntervaloCoberturaObservado(
                    inicio=inicio,
                    fin=fin,
                    cobertura=str(fila[1] or ""),
                    estado=str(fila[2] or ""),
                )
            )
        if sid not in mensual_por_suscripcion and sid not in suscripciones_vistas:
            suscripciones_vistas.append(sid)

    # Deduplicar preservando orden
    suscripciones_unicas = list(dict.fromkeys(suscripciones_vistas))
    ultimas_positivas = _obtener_ultima_actividad_positiva_por_suscripcion(
        organizacion_id, suscripciones_unicas
    )

    periodo_inicio_dt = datetime(int(anio), int(mes), 1, tzinfo=timezone.utc)
    periodo_fin_dt = datetime(fin_rango.year, fin_rango.month, fin_rango.day, tzinfo=timezone.utc)

    resultado: dict[str, UsoRecolectadoSuscripcion] = {}
    for suscripcion_id in suscripciones_unicas:
        ms_netos, minutos_netos = mensual_por_suscripcion.get(suscripcion_id, (0, 0))
        filas_cob = eventos_por_suscripcion.get(suscripcion_id, [])
        intervalos = intervalos_por_suscripcion.get(suscripcion_id, [])
        periodo_cubierto = _cubre_periodo_completo(intervalos, periodo_inicio_dt, periodo_fin_dt) if intervalos else False
        cobertura, estado, obs_completa, brecha = _resumir_cobertura_y_estado(
            filas_cob, periodo_cubierto_completamente=periodo_cubierto
        )
        # Si no hay fila mensual pero sí eventos, estimar duración positiva desde eventos.
        duracion_positiva_ms = max(0, int(ms_netos))
        if duracion_positiva_ms == 0 and filas_cob:
            duracion_positiva_ms = sum(max(0, int(fila.duracion_ms or 0)) for fila in filas_cob)
        resultado[suscripcion_id] = UsoRecolectadoSuscripcion(
            suscripcion_id=suscripcion_id,
            duracion_positiva_ms=duracion_positiva_ms,
            minutos_enteros_proyectados=max(0, int(minutos_netos)),
            cobertura_predominante=cobertura,
            estado_predominante=estado,
            existe_observacion_completa_activa=obs_completa,
            existe_brecha_de_medicion=brecha,
            fecha_ultima_actividad_positiva=ultimas_positivas.get(suscripcion_id),
        )

    # Incluir suscripciones solicitadas sin evidencia en tablas recolectoras como
    # ausencia de medición (silencio/sin datos recolectados en ventana).
    if suscripcion_ids:
        for suscripcion_id in suscripcion_ids:
            sid = str(suscripcion_id)
            if sid not in resultado:
                resultado[sid] = UsoRecolectadoSuscripcion(
                    suscripcion_id=sid,
                    duracion_positiva_ms=0,
                    minutos_enteros_proyectados=0,
                    cobertura_predominante=COBERTURA_SIN_MEDICION,
                    estado_predominante=ESTADO_PAUSADO,
                    existe_observacion_completa_activa=False,
                    existe_brecha_de_medicion=True,
                    fecha_ultima_actividad_positiva=ultimas_positivas.get(sid),
                )

    return resultado


def construir_evidencias_ventana(
    uso_por_suscripcion: dict[str, UsoRecolectadoSuscripcion]
) -> list[EvidenciaUsoVentana]:
    evidencias: list[EvidenciaUsoVentana] = []
    for item in uso_por_suscripcion.values():
        evidencias.append(
            EvidenciaUsoVentana(
                suscripcion_id=item.suscripcion_id,
                duracion_positiva_ms=item.duracion_positiva_ms,
                cobertura_predominante=item.cobertura_predominante,
                estado_predominante=item.estado_predominante,
                existe_observacion_completa_activa=item.existe_observacion_completa_activa,
                existe_brecha_de_medicion=item.existe_brecha_de_medicion,
                fecha_ultima_actividad_positiva=item.fecha_ultima_actividad_positiva,
                minutos_enteros_proyectados=item.minutos_enteros_proyectados,
            )
        )
    return evidencias

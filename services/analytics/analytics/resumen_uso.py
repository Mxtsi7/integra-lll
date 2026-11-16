"""Resumen de uso por suscripción y periodo (S3-VI-13).

Este módulo lee la proyección exacta que escribe el pipeline
``analytics-uso`` (``analytics.uso_evento``, ``analytics.uso_tramo`` y
``analytics.uso_diario``) y la presenta por suscripción y mes. **No escribe**
nada: es una vista de consulta sobre hechos ya aceptados.

Reglas que no se pueden perder al tocar esto:

* Los milisegundos son la unidad exacta. Los minutos se proyectan por día local
  con ``ms_netos // 60000`` y se suman esos enteros; nunca se divide la suma
  mensual de milisegundos ni se traslada un residuo a otro día.
* Una suscripción sin eventos medidos no es "uso cero": es ``sin_medicion``.
  Solo una cobertura ``completa`` con estado ``activo`` permite afirmar
  ``uso_cero_observado``. Los estados ``pausado``, ``sin_permiso`` y
  ``revocado`` tampoco informan actividad positiva.
* Toda consulta filtra por ``organizacion_id``. La organización sale del
  contexto autenticado, nunca del cuerpo ni de un parámetro.
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID

from django.db import DatabaseError, connection
from django.utils import timezone

from analytics.models import SuscripcionObservada
from analytics.uso import mes_siguiente, primer_dia

COBERTURAS = ("completa", "parcial", "sin_medicion")
ESTADOS_MEDICION = ("activo", "pausado", "sin_permiso", "revocado")
#: ``sin_medicion`` no es un estado observado del evento: es la respuesta
#: honesta cuando no hay medición. Por eso no entra en ``desglose_estados``,
#: pero sí es un valor válido de ``estado_medicion``.
ESTADOS_MEDICION_RESPUESTA = ESTADOS_MEDICION + ("sin_medicion",)
ESTADOS_SUSCRIPCION = ("prueba", "activo", "por_confirmar", "cancelado", "fantasma")

PAGINA_INICIAL = 1
TAMANO_PAGINA_INICIAL = 50
TAMANO_PAGINA_MAXIMO = 100


# ═══════════════════════════════════════════════════════════════════
# Clasificación (funciones puras, sin base de datos)
# ═══════════════════════════════════════════════════════════════════


def clasificar_cobertura(
    *, eventos_completos_activos: int, eventos_parciales_activos: int
) -> str:
    """Resume la cobertura del periodo a partir de los eventos medidos.

    Un solo evento ``parcial`` activo vuelve parcial el periodo: lo observado
    tiene huecos y no se puede presentar como completo. Si no hay ningún evento
    activo con cobertura completa o parcial, el periodo es ``sin_medicion``.
    """
    if eventos_parciales_activos > 0:
        return "parcial"
    if eventos_completos_activos > 0:
        return "completa"
    return "sin_medicion"


def clasificar_estado_medicion(
    *,
    eventos_completos_activos: int,
    eventos_parciales_activos: int,
    desglose_estados: dict[str, int],
) -> str:
    """Explica por qué hay o no medición en el periodo.

    Con eventos activos medidos el periodo está activo. Sin ellos, se informa
    el primer estado no activo observado. Si solo hubo eventos activos con
    ``cobertura: sin_medicion`` (o no hubo eventos), no se afirma ningún estado
    de la suscripción: la respuesta honesta es ``sin_medicion``.
    """
    if eventos_completos_activos > 0 or eventos_parciales_activos > 0:
        return "activo"
    for estado in ("pausado", "sin_permiso", "revocado"):
        if desglose_estados.get(estado, 0) > 0:
            return estado
    return "sin_medicion"


def calcular_uso_cero_observado(
    *, cobertura: str, estado_medicion: str, ms_netos: int
) -> bool:
    """Solo una cobertura completa y activa puede afirmar cero observado.

    Con cobertura parcial el cero vale únicamente para lo observado; los huecos
    no se rellenan con cero. Con ``sin_medicion`` el uso real es desconocido.
    """
    return cobertura == "completa" and estado_medicion == "activo" and ms_netos == 0


def validar_paginacion(page_crudo: Any, page_size_crudo: Any) -> tuple[int, int]:
    """Valida ``page``/``page_size`` y devuelve enteros acotados.

    La cota no es cosmética: sin ella una petición puede pedir la organización
    entera y convertir este resumen en una consulta sin límite.
    """
    try:
        page = int(page_crudo) if page_crudo not in (None, "") else PAGINA_INICIAL
    except (TypeError, ValueError) as exc:
        raise ValueError("page debe ser un entero mayor o igual a 1.") from exc
    try:
        page_size = (
            int(page_size_crudo)
            if page_size_crudo not in (None, "")
            else TAMANO_PAGINA_INICIAL
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("page_size debe ser un entero entre 1 y 100.") from exc

    if page < 1:
        raise ValueError("page debe ser un entero mayor o igual a 1.")
    if page_size < 1 or page_size > TAMANO_PAGINA_MAXIMO:
        raise ValueError("page_size debe ser un entero entre 1 y 100.")
    return page, page_size


def instante_utc_milisegundos(instante: dt.datetime | None) -> str | None:
    """Serializa un instante UTC con exactamente tres decimales y sufijo ``Z``.

    Es el mismo formato que publica ``subscriptions`` en el catálogo de
    eventos: hasta tres decimales, truncando los microsegundos, para no
    presentar un momento posterior al realmente observado.
    """
    if instante is None:
        return None
    if timezone.is_naive(instante):
        instante = timezone.make_aware(instante, dt.timezone.utc)
    return (
        instante.astimezone(dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


# ═══════════════════════════════════════════════════════════════════
# Lectura de las tablas del pipeline
# ═══════════════════════════════════════════════════════════════════


def _tabla_existe(nombre_calificado: str) -> bool:
    """Comprueba una tabla del pipeline sin asumir que el DDL ya se aplicó.

    En SQLite no existen los esquemas con nombre ni ``to_regclass``; el
    resumen degradado responde ``sin_medicion``, que es la verdad: no hay
    medición disponible.
    """
    if connection.vendor != "postgresql":
        return False
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass(%s)", [nombre_calificado])
            return cursor.fetchone()[0] is not None
    except DatabaseError:
        return False


def _vacio_por_suscripcion(suscripcion_id: UUID) -> dict[str, Any]:
    return {
        "desglose_cobertura": {clave: 0 for clave in COBERTURAS},
        "desglose_estados": {clave: 0 for clave in ESTADOS_MEDICION},
        "eventos_completos_activos": 0,
        "eventos_parciales_activos": 0,
        "eventos_observados": 0,
        "ms_netos": 0,
        "minutos_netos": 0,
        "dias_con_uso": 0,
        "ultima_actividad_positiva": None,
        "estado_suscripcion": None,
    }


def _consultar_uso_diario(
    *, organizacion_id: UUID, inicio: dt.date, fin: dt.date, ids: list[UUID]
) -> dict[UUID, dict[str, int]]:
    """Suma exacta de milisegundos y minutos diarios ya proyectados.

    ``minutos_netos`` se suma por día; no se recalcula desde el total de
    milisegundos. Así el residuo de un día no se convierte en un minuto de
    otro. ``dias_con_uso`` exige ``ms_netos > 0``: una fila de cero observado
    también existe en ``uso_diario`` y no es un día de uso.
    """
    if not ids or not _tabla_existe("analytics.uso_diario"):
        return {}
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT suscripcion_id,
                   COALESCE(SUM(ms_netos), 0) AS ms_netos,
                   COALESCE(SUM(minutos_netos), 0) AS minutos_netos,
                   COUNT(*) FILTER (WHERE ms_netos > 0) AS dias_con_uso
              FROM analytics.uso_diario
             WHERE organizacion_id = %s
               AND fecha_local BETWEEN %s AND %s
               AND suscripcion_id = ANY(%s::uuid[])
             GROUP BY suscripcion_id
            """,
            [str(organizacion_id), inicio, fin, [str(valor) for valor in ids]],
        )
        return {
            fila[0]: {
                "ms_netos": int(fila[1]),
                "minutos_netos": int(fila[2]),
                "dias_con_uso": int(fila[3]),
            }
            for fila in cursor.fetchall()
        }


def _consultar_eventos(
    *, organizacion_id: UUID, inicio: dt.date, fin: dt.date, ids: list[UUID]
) -> dict[UUID, dict[str, Any]]:
    """Cuenta eventos por cobertura y estado, y deriva los medidos.

    Solo ``estado: activo`` con cobertura ``completa`` o ``parcial`` cuenta
    como medición. Un evento pausado, sin permiso o revocado no aporta
    actividad positiva aunque traiga una ventana de tiempo.
    """
    if not ids or not _tabla_existe("analytics.uso_evento"):
        return {}
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT suscripcion_id, cobertura, estado, COUNT(*) AS cantidad
              FROM analytics.uso_evento
             WHERE organizacion_id = %s
               AND fecha_local BETWEEN %s AND %s
               AND suscripcion_id = ANY(%s::uuid[])
             GROUP BY suscripcion_id, cobertura, estado
            """,
            [str(organizacion_id), inicio, fin, [str(valor) for valor in ids]],
        )
        filas = cursor.fetchall()

    acumulado: dict[UUID, dict[str, Any]] = {}
    for suscripcion_id, cobertura, estado, cantidad in filas:
        datos = acumulado.setdefault(
            suscripcion_id, _vacio_por_suscripcion(suscripcion_id)
        )
        cantidad = int(cantidad)
        datos["eventos_observados"] += cantidad
        if cobertura in datos["desglose_cobertura"]:
            datos["desglose_cobertura"][cobertura] += cantidad
        if estado in datos["desglose_estados"]:
            datos["desglose_estados"][estado] += cantidad

        if estado == "activo" and cobertura == "completa":
            datos["eventos_completos_activos"] += cantidad
        elif estado == "activo" and cobertura == "parcial":
            datos["eventos_parciales_activos"] += cantidad
    return acumulado


def _consultar_ultima_actividad(
    *,
    organizacion_id: UUID,
    inicio: dt.date,
    fin: dt.date,
    ids: list[UUID],
    existe_evento: bool,
    existe_tramo: bool,
) -> dict[UUID, dt.datetime]:
    """Último final de un tramo positivo de un evento activo.

    ``fin`` del evento es el borde de la ventana observada, no necesariamente
    el último instante con actividad. Con ``uso_tramo`` disponible se usa el
    final real del último tramo; sin él, se degrada al ``fin`` del evento.
    """
    if not ids or not existe_evento:
        return {}

    if existe_tramo:
        consulta = """
            SELECT e.suscripcion_id, MAX(t.fin) AS ultima
              FROM analytics.uso_evento e
              JOIN analytics.uso_tramo t
                ON t.organizacion_id = e.organizacion_id
               AND t.recolector_id = e.recolector_id
               AND t.event_id = e.event_id
             WHERE e.organizacion_id = %s
               AND e.fecha_local BETWEEN %s AND %s
               AND e.suscripcion_id = ANY(%s::uuid[])
               AND e.estado = 'activo'
               AND e.duracion_ms > 0
             GROUP BY e.suscripcion_id
        """
    else:
        consulta = """
            SELECT suscripcion_id, MAX(fin) AS ultima
              FROM analytics.uso_evento
             WHERE organizacion_id = %s
               AND fecha_local BETWEEN %s AND %s
               AND suscripcion_id = ANY(%s::uuid[])
               AND estado = 'activo'
               AND duracion_ms > 0
             GROUP BY suscripcion_id
        """

    with connection.cursor() as cursor:
        cursor.execute(
            consulta,
            [str(organizacion_id), inicio, fin, [str(valor) for valor in ids]],
        )
        return {fila[0]: fila[1] for fila in cursor.fetchall() if fila[1] is not None}


def _consultar_estado_suscripcion(
    *, organizacion_id: UUID, ids: list[UUID]
) -> dict[UUID, str]:
    """Estado vigente proyectado por S3-VI-10, si la tabla ya existe."""
    if not ids or not _tabla_existe("analytics.suscripcion_estado"):
        return {}
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT suscripcion_id, estado
              FROM analytics.suscripcion_estado
             WHERE organizacion_id = %s
               AND suscripcion_id = ANY(%s::uuid[])
            """,
            [str(organizacion_id), [str(valor) for valor in ids]],
        )
        return {fila[0]: fila[1] for fila in cursor.fetchall()}


# ═══════════════════════════════════════════════════════════════════
# Armado de la página
# ═══════════════════════════════════════════════════════════════════


def construir_resumen_uso(
    *,
    organizacion_id: UUID,
    mes: dt.date,
    suscripcion_id: UUID | None = None,
    page: int = PAGINA_INICIAL,
    page_size: int = TAMANO_PAGINA_INICIAL,
) -> dict[str, Any]:
    """Devuelve una página del resumen de uso de la organización.

    La base de candidatas es ``SuscripcionObservada``: son las suscripciones
    que Analytics sabe que existen. Una suscripción con eventos pero sin
    registro de observación no aparece, porque no se puede afirmar desde cuándo
    se la observa ni interpretar su silencio.
    """
    mes = primer_dia(mes)
    inicio = mes
    fin = mes_siguiente(mes) - dt.timedelta(days=1)

    consulta = SuscripcionObservada.objects.filter(organizacion_id=organizacion_id)
    if suscripcion_id is not None:
        consulta = consulta.filter(suscripcion_id=suscripcion_id)

    total = consulta.count()
    desde_indice = (page - 1) * page_size
    filas = list(
        consulta.order_by("nombre", "suscripcion_id")
        .values("suscripcion_id", "nombre", "observada_desde")[
            desde_indice : desde_indice + page_size
        ]
    )
    ids = [fila["suscripcion_id"] for fila in filas]

    existe_evento = _tabla_existe("analytics.uso_evento")
    existe_tramo = _tabla_existe("analytics.uso_tramo")
    uso_diario = _consultar_uso_diario(
        organizacion_id=organizacion_id, inicio=inicio, fin=fin, ids=ids
    )
    eventos = _consultar_eventos(
        organizacion_id=organizacion_id, inicio=inicio, fin=fin, ids=ids
    )
    ultima_actividad = _consultar_ultima_actividad(
        organizacion_id=organizacion_id,
        inicio=inicio,
        fin=fin,
        ids=ids,
        existe_evento=existe_evento,
        existe_tramo=existe_tramo,
    )
    estados = _consultar_estado_suscripcion(organizacion_id=organizacion_id, ids=ids)

    resultados = []
    for fila in filas:
        suscripcion = fila["suscripcion_id"]
        datos = dict(eventos.get(suscripcion) or _vacio_por_suscripcion(suscripcion))
        datos.update(uso_diario.get(suscripcion, {}))

        cobertura = clasificar_cobertura(
            eventos_completos_activos=datos["eventos_completos_activos"],
            eventos_parciales_activos=datos["eventos_parciales_activos"],
        )
        estado_medicion = clasificar_estado_medicion(
            eventos_completos_activos=datos["eventos_completos_activos"],
            eventos_parciales_activos=datos["eventos_parciales_activos"],
            desglose_estados=datos["desglose_estados"],
        )
        ms_netos = int(datos.get("ms_netos", 0))

        resultados.append(
            {
                "suscripcion_id": suscripcion,
                "nombre": fila["nombre"],
                "observada_desde": (
                    fila["observada_desde"].isoformat()
                    if fila["observada_desde"]
                    else None
                ),
                "periodo": f"{mes:%Y-%m}",
                "ms_netos": ms_netos,
                "minutos_netos": int(datos.get("minutos_netos", 0)),
                "dias_con_uso": int(datos.get("dias_con_uso", 0)),
                "ultima_actividad_positiva": instante_utc_milisegundos(
                    ultima_actividad.get(suscripcion)
                ),
                "cobertura": cobertura,
                "estado_medicion": estado_medicion,
                "uso_cero_observado": calcular_uso_cero_observado(
                    cobertura=cobertura,
                    estado_medicion=estado_medicion,
                    ms_netos=ms_netos,
                ),
                "desglose_cobertura": datos["desglose_cobertura"],
                "desglose_estados": datos["desglose_estados"],
                "eventos_observados": int(datos.get("eventos_observados", 0)),
                "estado_suscripcion": estados.get(suscripcion),
            }
        )

    hay_siguiente = page * page_size < total
    return {
        "periodo": f"{mes:%Y-%m}",
        "count": total,
        "next": page + 1 if hay_siguiente else None,
        "previous": page - 1 if page > 1 else None,
        "page": page,
        "page_size": page_size,
        "results": resultados,
    }

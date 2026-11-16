"""S3-VI-13 contra PostgreSQL real, con las tablas del pipeline.

La suite unitaria degrada a ``sin_medicion`` cuando no hay esquema
``analytics`` (SQLite local). Esta prueba levanta el DDL real de
``analytics-uso`` y escribe hechos como los dejaría el consumidor, para
comprobar la aritmética exacta y el filtro por organización sobre PostgreSQL.

Se ejecuta solo con ``INTEGRACION_USO=1``. Con
``EXIGIR_INTEGRACION_USO=1`` la ausencia de PostgreSQL o de la bandera falla,
no se omite en silencio.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import uuid
from pathlib import Path

import pytest
from django.db import connection
from rest_framework.test import APIClient

from analytics.models import SuscripcionObservada

pytestmark = pytest.mark.django_db

SQL_PIPELINE = (
    Path(__file__).resolve().parents[2]
    / "analytics-uso"
    / "sql"
    / "001_uso_recolectores.sql"
)

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

COMPLETA = uuid.UUID("33333333-3333-3333-3333-333333333333")
CERO = uuid.UUID("44444444-4444-4444-4444-444444444444")
PAUSADA = uuid.UUID("55555555-5555-5555-5555-555555555555")
RESIDUO = uuid.UUID("66666666-6666-6666-6666-666666666666")
DE_OTRA_ORG = uuid.UUID("77777777-7777-7777-7777-777777777777")

MES = "2026-10"
RUTA = "/api/analitica/resumen-uso/"

RECOLECTOR_A = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
RECOLECTOR_B = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


def _no_disponible(motivo: str) -> None:
    if os.environ.get("EXIGIR_INTEGRACION_USO") == "1":
        pytest.fail(f"EXIGIR_INTEGRACION_USO=1 exige la integración real: {motivo}")
    pytest.skip(motivo)


@pytest.fixture(scope="session")
def requiere_integracion():
    if os.environ.get("INTEGRACION_USO") != "1":
        _no_disponible("define INTEGRACION_USO=1 para ejecutar la integración")
    if connection.vendor != "postgresql":
        _no_disponible("estas pruebas necesitan PostgreSQL real, no SQLite")


@pytest.fixture(scope="module")
def esquema_pipeline(django_db_setup, django_db_blocker, requiere_integracion):
    """Aplica y retira el DDL real del pipeline ``analytics-uso``."""
    with django_db_blocker.unblock():
        with connection.cursor() as cursor:
            cursor.execute("DROP SCHEMA IF EXISTS analytics CASCADE")
            cursor.execute(SQL_PIPELINE.read_text(encoding="utf-8"))
    yield
    with django_db_blocker.unblock():
        with connection.cursor() as cursor:
            cursor.execute("DROP SCHEMA IF EXISTS analytics CASCADE")


def _observar(org: uuid.UUID, suscripcion: uuid.UUID, nombre: str) -> None:
    SuscripcionObservada.objects.create(
        organizacion_id=org,
        suscripcion_id=suscripcion,
        nombre=nombre,
        observada_desde=dt.date(2026, 1, 1),
    )


def _insertar_evento(
    *,
    org: uuid.UUID,
    suscripcion: uuid.UUID,
    recolector: uuid.UUID,
    inicio: dt.datetime,
    fin: dt.datetime,
    duracion_ms: int,
    cobertura: str,
    estado: str,
    fecha_local: dt.date,
) -> uuid.UUID:
    event_id = uuid.uuid4()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO analytics.uso_evento (
                organizacion_id, recolector_id, event_id, suscripcion_id,
                usuario_id, origen, inicio, fin, duracion_ms,
                tramos_actividad, zona_horaria, cobertura, estado,
                fecha_local, huella, ocurrido_en, correlation_id
            ) VALUES (
                %s, %s, %s, %s, NULL, 'android', %s, %s, %s,
                %s::jsonb, 'America/Santiago', %s, %s, %s, %s, %s, %s
            )
            """,
            [
                str(org),
                str(recolector),
                str(event_id),
                str(suscripcion),
                inicio,
                fin,
                duracion_ms,
                json.dumps([{"inicio": inicio.isoformat(), "fin": fin.isoformat()}]),
                cobertura,
                estado,
                fecha_local,
                f"huella-{event_id}",
                fin,
                str(uuid.uuid4()),
            ],
        )
    return event_id


def _insertar_tramo(
    *,
    org: uuid.UUID,
    recolector: uuid.UUID,
    event_id: uuid.UUID,
    inicio: dt.datetime,
    fin: dt.datetime,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO analytics.uso_tramo (
                organizacion_id, recolector_id, event_id, indice, inicio, fin
            ) VALUES (%s, %s, %s, 0, %s, %s)
            """,
            [str(org), str(recolector), str(event_id), inicio, fin],
        )


def _insertar_diario(
    *,
    org: uuid.UUID,
    suscripcion: uuid.UUID,
    fecha_local: dt.date,
    ms_netos: int,
    minutos_netos: int,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO analytics.uso_diario (
                organizacion_id, suscripcion_id, fecha_local,
                ms_netos, minutos_netos, ms_residuo
            ) VALUES (%s, %s, %s, %s, %s, 0)
            """,
            [str(org), str(suscripcion), fecha_local, ms_netos, minutos_netos],
        )


def _insertar_estado(*, org: uuid.UUID, suscripcion: uuid.UUID, estado: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO analytics.suscripcion_estado (
                organizacion_id, suscripcion_id, proveedor_id, nombre, monto,
                moneda, ciclo, proximo_cobro, estado, fin_prueba,
                estado_anterior, evento_estado, ocurrido_en, event_id
            ) VALUES (
                %s, %s, NULL, 'Netflix', 9990.00, 'CLP', 'mensual',
                '2026-11-01', %s, NULL, NULL, NULL, %s, %s
            )
            """,
            [
                str(org),
                str(suscripcion),
                estado,
                dt.datetime(2026, 10, 1, 12, tzinfo=dt.timezone.utc),
                str(uuid.uuid4()),
            ],
        )


def _montar_hechos() -> None:
    _observar(ORG_A, COMPLETA, "Completa")
    _observar(ORG_A, CERO, "Cero observado")
    _observar(ORG_A, PAUSADA, "Pausada")
    _observar(ORG_A, RESIDUO, "Residuo")
    _observar(ORG_B, DE_OTRA_ORG, "De otra organización")

    # Dos eventos activos completos: 120 s + 30 s = 150 s exactos.
    primer_evento = _insertar_evento(
        org=ORG_A,
        suscripcion=COMPLETA,
        recolector=RECOLECTOR_A,
        inicio=dt.datetime(2026, 10, 5, 10, 0, tzinfo=dt.timezone.utc),
        fin=dt.datetime(2026, 10, 5, 10, 2, tzinfo=dt.timezone.utc),
        duracion_ms=120_000,
        cobertura="completa",
        estado="activo",
        fecha_local=dt.date(2026, 10, 5),
    )
    _insertar_tramo(
        org=ORG_A,
        recolector=RECOLECTOR_A,
        event_id=primer_evento,
        inicio=dt.datetime(2026, 10, 5, 10, 0, tzinfo=dt.timezone.utc),
        fin=dt.datetime(2026, 10, 5, 10, 2, tzinfo=dt.timezone.utc),
    )
    segundo_evento = _insertar_evento(
        org=ORG_A,
        suscripcion=COMPLETA,
        recolector=RECOLECTOR_A,
        inicio=dt.datetime(2026, 10, 6, 10, 0, tzinfo=dt.timezone.utc),
        fin=dt.datetime(2026, 10, 6, 10, 0, 30, tzinfo=dt.timezone.utc),
        duracion_ms=30_000,
        cobertura="completa",
        estado="activo",
        fecha_local=dt.date(2026, 10, 6),
    )
    _insertar_tramo(
        org=ORG_A,
        recolector=RECOLECTOR_A,
        event_id=segundo_evento,
        inicio=dt.datetime(2026, 10, 6, 10, 0, tzinfo=dt.timezone.utc),
        fin=dt.datetime(2026, 10, 6, 10, 0, 30, tzinfo=dt.timezone.utc),
    )
    _insertar_diario(
        org=ORG_A, suscripcion=COMPLETA,
        fecha_local=dt.date(2026, 10, 5), ms_netos=120_000, minutos_netos=2,
    )
    _insertar_diario(
        org=ORG_A, suscripcion=COMPLETA,
        fecha_local=dt.date(2026, 10, 6), ms_netos=30_000, minutos_netos=0,
    )
    _insertar_estado(org=ORG_A, suscripcion=COMPLETA, estado="activo")

    # Cero observado: evento completo activo sin actividad.
    _insertar_evento(
        org=ORG_A,
        suscripcion=CERO,
        recolector=RECOLECTOR_A,
        inicio=dt.datetime(2026, 10, 7, 10, 0, tzinfo=dt.timezone.utc),
        fin=dt.datetime(2026, 10, 7, 10, 0, 30, tzinfo=dt.timezone.utc),
        duracion_ms=0,
        cobertura="completa",
        estado="activo",
        fecha_local=dt.date(2026, 10, 7),
    )
    _insertar_diario(
        org=ORG_A, suscripcion=CERO,
        fecha_local=dt.date(2026, 10, 7), ms_netos=0, minutos_netos=0,
    )

    # Sin permiso de medir: ni cero ni actividad.
    _insertar_evento(
        org=ORG_A,
        suscripcion=PAUSADA,
        recolector=RECOLECTOR_A,
        inicio=dt.datetime(2026, 10, 8, 10, 0, tzinfo=dt.timezone.utc),
        fin=dt.datetime(2026, 10, 8, 10, 0, 30, tzinfo=dt.timezone.utc),
        duracion_ms=0,
        cobertura="sin_medicion",
        estado="pausado",
        fecha_local=dt.date(2026, 10, 8),
    )

    # Dos días de 59 s: la suma mensual es 118 s, pero los minutos son 0.
    _insertar_diario(
        org=ORG_A, suscripcion=RESIDUO,
        fecha_local=dt.date(2026, 10, 9), ms_netos=59_000, minutos_netos=0,
    )
    _insertar_diario(
        org=ORG_A, suscripcion=RESIDUO,
        fecha_local=dt.date(2026, 10, 10), ms_netos=59_000, minutos_netos=0,
    )

    # Organización ajena: no debe aparecer en la respuesta de ORG_A.
    _insertar_evento(
        org=ORG_B,
        suscripcion=DE_OTRA_ORG,
        recolector=RECOLECTOR_B,
        inicio=dt.datetime(2026, 10, 5, 10, 0, tzinfo=dt.timezone.utc),
        fin=dt.datetime(2026, 10, 5, 12, 0, tzinfo=dt.timezone.utc),
        duracion_ms=7_200_000,
        cobertura="completa",
        estado="activo",
        fecha_local=dt.date(2026, 10, 5),
    )
    _insertar_diario(
        org=ORG_B, suscripcion=DE_OTRA_ORG,
        fecha_local=dt.date(2026, 10, 5), ms_netos=7_200_000, minutos_netos=120,
    )


def _pedir(org: uuid.UUID = ORG_A, **params):
    return APIClient().get(
        RUTA,
        params,
        HTTP_X_ORGANIZACION_ID=str(org),
    )


def _por_suscripcion(respuesta) -> dict[str, dict]:
    return {fila["suscripcion_id"]: fila for fila in respuesta.data["results"]}


@pytest.mark.usefixtures("esquema_pipeline")
class TestResumenUsoPostgreSQL:
    def setup_method(self):
        _montar_hechos()

    def test_milisegundos_exactos_y_minutos_proyectados_por_dia(self):
        respuesta = _pedir(mes=MES)

        assert respuesta.status_code == 200, respuesta.data
        filas = _por_suscripcion(respuesta)
        completa = filas[str(COMPLETA)]

        assert completa["ms_netos"] == 150_000
        assert completa["minutos_netos"] == 2
        assert completa["dias_con_uso"] == 2
        assert completa["eventos_observados"] == 2
        assert completa["cobertura"] == "completa"
        assert completa["estado_medicion"] == "activo"
        assert completa["uso_cero_observado"] is False
        assert completa["ultima_actividad_positiva"] == "2026-10-06T10:00:30.000Z"
        assert completa["estado_suscripcion"] == "activo"
        assert completa["desglose_cobertura"] == {
            "completa": 2,
            "parcial": 0,
            "sin_medicion": 0,
        }

    def test_cero_observado_se_distingue_de_sin_medicion(self):
        filas = _por_suscripcion(_pedir(mes=MES))
        cero = filas[str(CERO)]
        pausada = filas[str(PAUSADA)]

        assert cero["ms_netos"] == 0
        assert cero["cobertura"] == "completa"
        assert cero["estado_medicion"] == "activo"
        assert cero["uso_cero_observado"] is True
        assert cero["ultima_actividad_positiva"] is None

        assert pausada["ms_netos"] == 0
        assert pausada["cobertura"] == "sin_medicion"
        assert pausada["estado_medicion"] == "pausado"
        assert pausada["uso_cero_observado"] is False

    def test_el_residuo_de_cada_dia_no_se_traslada_al_siguiente(self):
        residuo = _por_suscripcion(_pedir(mes=MES))[str(RESIDUO)]

        assert residuo["ms_netos"] == 118_000
        assert residuo["minutos_netos"] == 0
        assert residuo["dias_con_uso"] == 2

    def test_no_mezcla_organizaciones(self):
        respuesta = _pedir(mes=MES)

        assert respuesta.data["count"] == 4
        assert str(DE_OTRA_ORG) not in _por_suscripcion(respuesta)

        respuesta_b = _pedir(org=ORG_B, mes=MES)
        assert respuesta_b.data["count"] == 1
        assert [fila["suscripcion_id"] for fila in respuesta_b.data["results"]] == [
            str(DE_OTRA_ORG)
        ]

    def test_pagina_acotada_sobre_postgresql(self):
        primera = _pedir(mes=MES, page=1, page_size=2)
        segunda = _pedir(mes=MES, page=2, page_size=2)

        assert primera.data["count"] == 4
        assert primera.data["next"] == 2
        assert primera.data["previous"] is None
        assert len(primera.data["results"]) == 2

        assert segunda.data["next"] is None
        assert segunda.data["previous"] == 1
        assert len(segunda.data["results"]) == 2

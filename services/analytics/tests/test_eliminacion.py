import json
import uuid
from pathlib import Path

import pytest
from rest_framework.test import APIClient

from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion

RAIZ = Path(__file__).resolve().parents[3]
DDL_USO = RAIZ / "services" / "analytics-uso" / "sql" / "001_uso_recolectores.sql"
TABLAS_USO = (
    "analytics.uso_tramo", "analytics.uso_evento",
    "analytics.uso_diario", "analytics.uso_mensual_recolector",
)

# Forma real de la tabla que crea la migración 0006 de Analytics (Django) para
# `UsoMensual`. En producción vive en el esquema `analytics`; las pruebas
# normales la dejan en `public` por el `search_path` del conftest. Este DDL
# reproduce la convivencia real en el mismo esquema que el pipeline.
DDL_DJANGO_USO_MENSUAL = """
CREATE TABLE IF NOT EXISTS analytics.uso_mensual (
    id uuid PRIMARY KEY,
    creado_en timestamptz NOT NULL,
    actualizado_en timestamptz NOT NULL,
    organizacion_id uuid NOT NULL,
    suscripcion_id uuid NOT NULL,
    mes date NOT NULL,
    minutos integer NOT NULL DEFAULT 0 CHECK (minutos >= 0),
    dias_con_uso integer NOT NULL DEFAULT 0 CHECK (dias_con_uso >= 0),
    ultimo_uso date NULL,
    CONSTRAINT uso_mensual_unico_por_tenant_suscripcion_mes
        UNIQUE (organizacion_id, suscripcion_id, mes)
)
"""


def limpiar(org):
    operacion = uuid.uuid4()
    firma = cabeceras_eliminacion("analytics", org, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )


def recomendacion(org):
    from django.utils import timezone
    from analytics.models import RecomendacionConsolidacion

    return RecomendacionConsolidacion.objects.create(
        id=uuid.uuid4(), organizacion_id=org, evento_origen_id=uuid.uuid4(),
        correlation_id=uuid.uuid4(), ocurrido_en=timezone.now(),
        categoria="streaming", suscripcion_id=uuid.uuid4(),
        suscripcion_nombre="Servicio", motivo="Solapamiento", ahorro_estimado="1000",
        moneda="CLP", evidencia_id="catalogo:1", evidencia_url="https://example.com/1",
        evidencia_descripcion="Funciones compartidas",
    )


@pytest.mark.django_db
def test_limpieza_incluye_proyecciones_y_descartes_sin_tocar_otro_tenant(monkeypatch):
    from django.utils import timezone
    from analytics.models import (
        CoberturaUso, RecomendacionConsolidacion, RecomendacionDescartada,
        SuscripcionObservada, UmbralAhorro, UsoMensual, UsoProyectado,
    )

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    hoy = timezone.localdate()
    umbral = UmbralAhorro.objects.create(moneda="CLP", monto="1000")
    for tenant in (org, otra):
        susc = uuid.uuid4()
        SuscripcionObservada.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, observada_desde=hoy,
        )
        CoberturaUso.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, desde=hoy, hasta=hoy,
        )
        UsoProyectado.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, evento_id=uuid.uuid4(),
            fecha=hoy, minutos=30,
        )
        UsoMensual.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, mes=hoy.replace(day=1), minutos=30,
        )
        RecomendacionDescartada.objects.create(
            organizacion_id=tenant, recomendacion=recomendacion(tenant), descartado_por=42,
        )
    for _ in range(2):
        assert limpiar(org).status_code == 204
    for modelo in (
        SuscripcionObservada, CoberturaUso, UsoProyectado, UsoMensual,
        RecomendacionConsolidacion, RecomendacionDescartada,
    ):
        assert not modelo.objects.filter(organizacion_id=org).exists()
        assert modelo.objects.filter(organizacion_id=otra).count() == 1
    assert UmbralAhorro.objects.filter(pk=umbral.pk).exists()


@pytest.mark.django_db
def test_descarte_ajeno_bloquea_limpieza_y_revierte_marca(monkeypatch):
    from analytics.models import RecomendacionConsolidacion, RecomendacionDescartada

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    rec = recomendacion(org)
    descarte = RecomendacionDescartada.objects.create(
        organizacion_id=otra, recomendacion=rec,
    )
    assert limpiar(org).status_code == 409
    assert RecomendacionConsolidacion.objects.filter(pk=rec.pk).exists()
    assert RecomendacionDescartada.objects.filter(pk=descarte.pk).exists()
    assert not EstadoOrganizacion.objects.filter(organizacion_id=org, eliminada=True).exists()


@pytest.mark.django_db
def test_ack_analytics_persiste_marca_sin_cupos(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, operacion = uuid.uuid4(), uuid.uuid4()
    firma = cabeceras_eliminacion("analytics", org, operacion)
    respuesta = APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )
    assert respuesta.status_code == 204
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada


def _aplicar_ddl_uso():
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(DDL_USO.read_text(encoding="utf-8"))


def _insertar_filas_uso(org):
    """Una fila por tabla `uso_*` del pipeline TypeScript, con su FK real."""
    from django.db import connection

    evento = uuid.uuid5(uuid.NAMESPACE_URL, f"evento:{org}")
    recolector = uuid.uuid5(uuid.NAMESPACE_URL, f"recolector:{org}")
    suscripcion = uuid.uuid5(uuid.NAMESPACE_URL, f"suscripcion:{org}")
    inicio = "2026-11-09T12:00:00Z"
    fin = "2026-11-09T12:02:00Z"

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO analytics.uso_evento (
                organizacion_id, recolector_id, event_id, suscripcion_id,
                usuario_id, origen, inicio, fin, duracion_ms, tramos_actividad,
                zona_horaria, cobertura, estado, fecha_local, huella,
                ocurrido_en, correlation_id
            ) VALUES (
                %s, %s, %s, %s, NULL, 'android', %s, %s, 30000, %s::jsonb,
                'America/Santiago', 'completa', 'activo', '2026-11-09', %s,
                %s, %s
            )
            """,
            [
                org, recolector, evento, suscripcion, inicio, fin,
                json.dumps([{"inicio": inicio, "fin": "2026-11-09T12:00:30Z"}]),
                "a" * 64, inicio, uuid.uuid4(),
            ],
        )
        cursor.execute(
            """
            INSERT INTO analytics.uso_tramo (
                organizacion_id, recolector_id, event_id, indice, inicio, fin
            ) VALUES (%s, %s, %s, 0, %s, %s)
            """,
            [org, recolector, evento, inicio, fin],
        )
        cursor.execute(
            """
            INSERT INTO analytics.uso_diario (
                organizacion_id, suscripcion_id, fecha_local,
                ms_netos, minutos_netos, ms_residuo
            ) VALUES (%s, %s, '2026-11-09', 30000, 0, 30000)
            """,
            [org, suscripcion],
        )
        cursor.execute(
            """
            INSERT INTO analytics.uso_mensual_recolector (
                organizacion_id, suscripcion_id, anio, mes, minutos_netos, ms_netos
            ) VALUES (%s, %s, 2026, 11, 0, 30000)
            """,
            [org, suscripcion],
        )


def _contar_filas_uso(org):
    from django.db import connection

    with connection.cursor() as cursor:
        conteos = {}
        for tabla in TABLAS_USO:
            cursor.execute(
                f"SELECT count(*) FROM {tabla} WHERE organizacion_id = %s",
                [org],
            )
            conteos[tabla] = cursor.fetchone()[0]
        return conteos


@pytest.mark.django_db
def test_limpieza_borra_las_cuatro_tablas_uso_del_tenant_y_conserva_el_otro(
    monkeypatch,
):
    """A/B real: A queda vacío en todas las `uso_*`; B conserva sus cuatro filas."""
    from django.db import connection

    if connection.vendor != "postgresql":
        pytest.skip("las tablas uso_* del consumidor solo existen en PostgreSQL")

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    _aplicar_ddl_uso()
    _insertar_filas_uso(org)
    _insertar_filas_uso(otra)

    assert set(_contar_filas_uso(org).values()) == {1}
    assert set(_contar_filas_uso(otra).values()) == {1}

    for _ in range(2):
        assert limpiar(org).status_code == 204

    assert _contar_filas_uso(org) == {tabla: 0 for tabla in TABLAS_USO}
    assert set(_contar_filas_uso(otra).values()) == {1}
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada


@pytest.mark.django_db
def test_convive_con_uso_mensual_de_django_y_limpia_solo_su_agregado(
    monkeypatch,
):
    """Reproduce la base real: Django ya migró `analytics.uso_mensual`.

    Después se aplica el DDL del pipeline en el mismo esquema. La limpieza debe
    borrar `uso_mensual_recolector` por organización y dejar intacta la tabla
    del modelo Django, que se elimina con su propio modelo y no con un DELETE
    ajeno a su contrato.
    """
    from django.db import connection

    if connection.vendor != "postgresql":
        pytest.skip("las tablas uso_* del consumidor solo existen en PostgreSQL")

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()

    with connection.cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS analytics")
        cursor.execute(DDL_DJANGO_USO_MENSUAL)
        cursor.execute(
            "DELETE FROM analytics.uso_mensual WHERE organizacion_id IN (%s, %s)",
            [org, otra],
        )
        for tenant in (org, otra):
            cursor.execute(
                """
                INSERT INTO analytics.uso_mensual (
                    id, creado_en, actualizado_en, organizacion_id,
                    suscripcion_id, mes, minutos, dias_con_uso, ultimo_uso
                ) VALUES (
                    %s, now(), now(), %s, %s, '2026-11-01', 7, 2, '2026-11-09'
                )
                """,
                [uuid.uuid4(), tenant, uuid.uuid4()],
            )

    # El DDL del pipeline se aplica sobre la base que Django ya migró.
    _aplicar_ddl_uso()
    _insertar_filas_uso(org)
    _insertar_filas_uso(otra)

    assert set(_contar_filas_uso(org).values()) == {1}
    assert limpiar(org).status_code == 204

    # El agregado propio del pipeline se borra por organización.
    assert _contar_filas_uso(org) == {tabla: 0 for tabla in TABLAS_USO}
    assert set(_contar_filas_uso(otra).values()) == {1}

    # `analytics.uso_mensual` pertenece a Django: la limpieza del pipeline no
    # la toca. Su borrado lo hace `UsoMensual` con el modelo del servicio.
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM analytics.uso_mensual WHERE organizacion_id = %s",
            [org],
        )
        assert cursor.fetchone()[0] == 1


@pytest.mark.django_db
def test_limpieza_cupos_ia_es_idempotente_y_conserva_otro_tenant(monkeypatch):
    from datetime import timedelta
    from django.utils import timezone
    from analytics.models import (
        ConsumoMensualIA, CupoIngesta, DocumentoIngesta, IntentoPDF,
    )

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    ajenos = {}
    for tenant in (org, otra):
        cupo = CupoIngesta.objects.create(organizacion_id=tenant, usuario_id=42)
        documento = DocumentoIngesta.objects.create(
            cupo=cupo, clave=uuid.uuid4(),
            vence_en=timezone.now() + timedelta(minutes=5),
        )
        intento = IntentoPDF.objects.create(
            cupo=cupo, huella="a" * 64, dia=timezone.localdate(), intentos=2,
        )
        consumo = ConsumoMensualIA.objects.create(
            cupo=cupo, mes=timezone.localdate().replace(day=1), llamadas=3,
        )
        if tenant == otra:
            ajenos = {
                CupoIngesta: cupo.pk, DocumentoIngesta: documento.pk,
                IntentoPDF: intento.pk, ConsumoMensualIA: consumo.pk,
            }

    for _ in range(2):
        firma = cabeceras_eliminacion("analytics", org, operacion)
        respuesta = APIClient().delete(
            f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)},
            format="json",
            **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
        )
        assert respuesta.status_code == 204
        assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
        assert not CupoIngesta.objects.filter(organizacion_id=org).exists()
        for modelo, pk in ajenos.items():
            assert modelo.objects.count() == 1
            assert modelo.objects.filter(pk=pk).exists()

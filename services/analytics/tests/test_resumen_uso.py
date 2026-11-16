"""S3-VI-13 — resumen de uso por suscripción y periodo.

Lo que estas pruebas protegen, en orden de importancia:

* **Cero observado no es lo mismo que sin medición.** Solo una cobertura
  completa con estado activo permite afirmar un cero; el resto es silencio.
* **Los milisegundos son la unidad exacta.** Los minutos se suman por día ya
  proyectado y nunca se recalculan desde el total mensual.
* **Toda consulta filtra por organización.** El resumen no puede mezclar
  tenants ni aceptar la organización por parámetro.
* Sin tablas del pipeline (SQLite local) la respuesta degrada a
  ``sin_medicion`` en vez de fallar o inventar ceros.
"""

import datetime as dt
import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from analytics import resumen_uso
from analytics.models import SuscripcionObservada
from analytics.resumen_uso import (
    calcular_uso_cero_observado,
    clasificar_cobertura,
    clasificar_estado_medicion,
    construir_resumen_uso,
    instante_utc_milisegundos,
    validar_paginacion,
)

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

SUSC_CERO = uuid.UUID("33333333-3333-3333-3333-333333333333")
SUSC_SIN_MEDICION = uuid.UUID("44444444-4444-4444-4444-444444444444")
SUSC_PAUSADA = uuid.UUID("55555555-5555-5555-5555-555555555555")
SUSC_RESPALDO = uuid.UUID("66666666-6666-6666-6666-666666666666")
SUSC_OTRO_TENANT = uuid.UUID("77777777-7777-7777-7777-777777777777")

OCTUBRE = dt.date(2026, 10, 1)
PERIODO_OCTUBRE = "2026-10"


def observar(
    *,
    org: uuid.UUID = ORG_A,
    suscripcion: uuid.UUID = SUSC_CERO,
    nombre: str = "Netflix",
    desde: dt.date = dt.date(2026, 1, 1),
) -> SuscripcionObservada:
    return SuscripcionObservada.objects.create(
        organizacion_id=org,
        suscripcion_id=suscripcion,
        nombre=nombre,
        observada_desde=desde,
    )


def _sin_datos(**_: object) -> dict:
    return {}


# ══════════════════════════════════════════════════════════════════════
# Clasificación pura: dónde se decide qué se puede afirmar
# ══════════════════════════════════════════════════════════════════════


class TestClasificacionCobertura:
    def test_sin_eventos_medidos_es_sin_medicion(self):
        assert (
            clasificar_cobertura(
                eventos_completos_activos=0, eventos_parciales_activos=0
            )
            == "sin_medicion"
        )

    def test_un_solo_evento_completo_activo_basta_para_completa(self):
        assert (
            clasificar_cobertura(
                eventos_completos_activos=1, eventos_parciales_activos=0
            )
            == "completa"
        )

    def test_un_parcial_vuelve_parcial_el_periodo_aunque_haya_completos(self):
        assert (
            clasificar_cobertura(
                eventos_completos_activos=9, eventos_parciales_activos=1
            )
            == "parcial"
        )

    def test_parciales_sin_completos_tambien_es_parcial(self):
        assert (
            clasificar_cobertura(
                eventos_completos_activos=0, eventos_parciales_activos=2
            )
            == "parcial"
        )


class TestClasificacionEstadoMedicion:
    def test_con_medicion_activa_el_estado_es_activo(self):
        assert (
            clasificar_estado_medicion(
                eventos_completos_activos=0,
                eventos_parciales_activos=1,
                desglose_estados={"activo": 0},
            )
            == "activo"
        )

    @pytest.mark.parametrize("estado", ["pausado", "sin_permiso", "revocado"])
    def test_sin_medicion_informa_el_estado_observado(self, estado):
        assert (
            clasificar_estado_medicion(
                eventos_completos_activos=0,
                eventos_parciales_activos=0,
                desglose_estados={estado: 1},
            )
            == estado
        )

    def test_pausado_tiene_precedencia_sobre_los_demas_no_activos(self):
        assert (
            clasificar_estado_medicion(
                eventos_completos_activos=0,
                eventos_parciales_activos=0,
                desglose_estados={"revocado": 3, "pausado": 1},
            )
            == "pausado"
        )

    def test_solo_eventos_activos_sin_cobertura_no_afirma_estado(self):
        """Un activo ``sin_medicion`` no es un activo medido."""
        assert (
            clasificar_estado_medicion(
                eventos_completos_activos=0,
                eventos_parciales_activos=0,
                desglose_estados={"activo": 5},
            )
            == "sin_medicion"
        )


class TestUsoCeroObservado:
    @pytest.mark.parametrize(
        ("cobertura", "estado", "ms_netos", "esperado"),
        [
            ("completa", "activo", 0, True),
            ("completa", "activo", 1, False),
            ("parcial", "activo", 0, False),
            ("sin_medicion", "sin_medicion", 0, False),
            ("completa", "pausado", 0, False),
        ],
    )
    def test_solo_completa_activa_y_cero_afirma_cero(
        self, cobertura, estado, ms_netos, esperado
    ):
        assert (
            calcular_uso_cero_observado(
                cobertura=cobertura, estado_medicion=estado, ms_netos=ms_netos
            )
            is esperado
        )


class TestFormatoInstante:
    def test_none_se_preserva(self):
        assert instante_utc_milisegundos(None) is None

    def test_trunca_microsegundos_sin_redondear(self):
        instante = dt.datetime(
            2026, 11, 9, 12, 2, 1, 123456, tzinfo=dt.timezone.utc
        )
        assert instante_utc_milisegundos(instante) == "2026-11-09T12:02:01.123Z"

    def test_naive_se_interpreta_como_utc(self):
        instante = dt.datetime(2026, 11, 9, 12, 2, 1, 999999)
        assert instante_utc_milisegundos(instante) == "2026-11-09T12:02:01.999Z"

    def test_convierte_a_utc_antes_de_serializar(self):
        instante = dt.datetime(
            2026,
            11,
            9,
            9,
            2,
            1,
            tzinfo=dt.timezone(dt.timedelta(hours=-3)),
        )
        assert instante_utc_milisegundos(instante) == "2026-11-09T12:02:01.000Z"


class TestPaginacion:
    def test_por_omision_usa_la_primera_pagina_y_50(self):
        assert validar_paginacion(None, None) == (1, 50)

    def test_acepta_valores_validos(self):
        assert validar_paginacion("3", "100") == (3, 100)

    @pytest.mark.parametrize("page", ["0", "-1", "abc", "1.5"])
    def test_page_invalida_levanta_value_error(self, page):
        with pytest.raises(ValueError, match="page"):
            validar_paginacion(page, None)

    @pytest.mark.parametrize("page_size", ["0", "101", "-5", "abc"])
    def test_page_size_fuera_de_rango_levanta_value_error(self, page_size):
        with pytest.raises(ValueError, match="page_size"):
            validar_paginacion(None, page_size)


# ══════════════════════════════════════════════════════════════════════
# Armado con datos: cero observado, sin medición y tenant
# ══════════════════════════════════════════════════════════════════════


def _montar_lecturas(
    monkeypatch,
    *,
    eventos: dict | None = None,
    diario: dict | None = None,
    ultima: dict | None = None,
    estados: dict | None = None,
):
    monkeypatch.setattr(resumen_uso, "_tabla_existe", lambda _: True)
    monkeypatch.setattr(
        resumen_uso, "_consultar_eventos", lambda **_: eventos or {}
    )
    monkeypatch.setattr(
        resumen_uso, "_consultar_uso_diario", lambda **_: diario or {}
    )
    monkeypatch.setattr(
        resumen_uso, "_consultar_ultima_actividad", lambda **_: ultima or {}
    )
    monkeypatch.setattr(
        resumen_uso, "_consultar_estado_suscripcion", lambda **_: estados or {}
    )


class TestArmadoResumen:
    def test_cero_observado_se_afirma_solo_con_completa_y_activo(
        self, monkeypatch
    ):
        observar(suscripcion=SUSC_CERO, nombre="Cero")
        _montar_lecturas(
            monkeypatch,
            eventos={
                SUSC_CERO: {
                    **resumen_uso._vacio_por_suscripcion(SUSC_CERO),
                    "eventos_completos_activos": 1,
                    "eventos_observados": 1,
                    "desglose_cobertura": {
                        "completa": 1,
                        "parcial": 0,
                        "sin_medicion": 0,
                    },
                    "desglose_estados": {
                        "activo": 1,
                        "pausado": 0,
                        "sin_permiso": 0,
                        "revocado": 0,
                    },
                }
            },
            diario={
                SUSC_CERO: {
                    "ms_netos": 0,
                    "minutos_netos": 0,
                    "dias_con_uso": 0,
                }
            },
        )

        pagina = construir_resumen_uso(organizacion_id=ORG_A, mes=OCTUBRE)
        fila = pagina["results"][0]

        assert fila["ms_netos"] == 0
        assert fila["minutos_netos"] == 0
        assert fila["dias_con_uso"] == 0
        assert fila["cobertura"] == "completa"
        assert fila["estado_medicion"] == "activo"
        assert fila["uso_cero_observado"] is True

    def test_sin_eventos_no_se_rellena_con_cero(self, monkeypatch):
        observar(suscripcion=SUSC_SIN_MEDICION, nombre="Sin medición")
        _montar_lecturas(monkeypatch)

        fila = construir_resumen_uso(organizacion_id=ORG_A, mes=OCTUBRE)["results"][0]

        assert fila["eventos_observados"] == 0
        assert fila["cobertura"] == "sin_medicion"
        assert fila["estado_medicion"] == "sin_medicion"
        assert fila["uso_cero_observado"] is False
        assert fila["ultima_actividad_positiva"] is None

    def test_un_estado_no_activo_no_se_presenta_como_uso_cero(self, monkeypatch):
        observar(suscripcion=SUSC_PAUSADA, nombre="Pausada")
        base = resumen_uso._vacio_por_suscripcion(SUSC_PAUSADA)
        base["desglose_estados"] = {
            "activo": 0,
            "pausado": 2,
            "sin_permiso": 0,
            "revocado": 0,
        }
        base["eventos_observados"] = 2
        _montar_lecturas(monkeypatch, eventos={SUSC_PAUSADA: base})

        fila = construir_resumen_uso(organizacion_id=ORG_A, mes=OCTUBRE)["results"][0]

        assert fila["cobertura"] == "sin_medicion"
        assert fila["estado_medicion"] == "pausado"
        assert fila["uso_cero_observado"] is False

    def test_suma_minutos_por_dia_y_conserva_milisegundos_exactos(
        self, monkeypatch
    ):
        """Dos días de 59 s no son un minuto: el residuo no se traslada."""
        observar(suscripcion=SUSC_CERO, nombre="Residuo")
        _montar_lecturas(
            monkeypatch,
            diario={
                SUSC_CERO: {
                    "ms_netos": 118_000,
                    "minutos_netos": 0,
                    "dias_con_uso": 2,
                }
            },
        )

        fila = construir_resumen_uso(organizacion_id=ORG_A, mes=OCTUBRE)["results"][0]

        assert fila["ms_netos"] == 118_000
        assert fila["minutos_netos"] == 0
        assert fila["dias_con_uso"] == 2

    def test_ultima_actividad_y_estado_proyectado_se_copian(
        self, monkeypatch
    ):
        observar(suscripcion=SUSC_CERO, nombre="Con actividad")
        instante = dt.datetime(2026, 10, 6, 9, 1, tzinfo=dt.timezone.utc)
        _montar_lecturas(
            monkeypatch,
            eventos={SUSC_CERO: resumen_uso._vacio_por_suscripcion(SUSC_CERO)},
            ultima={SUSC_CERO: instante},
            estados={SUSC_CERO: "activo"},
        )

        fila = construir_resumen_uso(organizacion_id=ORG_A, mes=OCTUBRE)["results"][0]

        assert fila["ultima_actividad_positiva"] == "2026-10-06T09:01:00.000Z"
        assert fila["estado_suscripcion"] == "activo"

    def test_no_mezcla_organizaciones(self, monkeypatch):
        observar(org=ORG_A, suscripcion=SUSC_CERO, nombre="De A")
        observar(org=ORG_B, suscripcion=SUSC_OTRO_TENANT, nombre="De B")
        _montar_lecturas(monkeypatch)

        pagina = construir_resumen_uso(organizacion_id=ORG_A, mes=OCTUBRE)

        assert pagina["count"] == 1
        assert [fila["suscripcion_id"] for fila in pagina["results"]] == [SUSC_CERO]

    def test_pagina_acotada_y_enlaces_son_numeros_de_pagina(
        self, monkeypatch
    ):
        observar(suscripcion=uuid.uuid4(), nombre="A")
        observar(suscripcion=uuid.uuid4(), nombre="B")
        observar(suscripcion=uuid.uuid4(), nombre="C")
        _montar_lecturas(monkeypatch)

        primera = construir_resumen_uso(
            organizacion_id=ORG_A, mes=OCTUBRE, page=1, page_size=2
        )
        segunda = construir_resumen_uso(
            organizacion_id=ORG_A, mes=OCTUBRE, page=2, page_size=2
        )

        assert primera["count"] == 3
        assert primera["page"] == 1
        assert primera["page_size"] == 2
        assert primera["next"] == 2
        assert primera["previous"] is None
        assert len(primera["results"]) == 2

        assert segunda["next"] is None
        assert segunda["previous"] == 1
        assert len(segunda["results"]) == 1

    def test_filtra_por_suscripcion_pedida(self, monkeypatch):
        observar(suscripcion=SUSC_CERO, nombre="Elegida")
        observar(suscripcion=SUSC_RESPALDO, nombre="Otra")
        _montar_lecturas(monkeypatch)

        pagina = construir_resumen_uso(
            organizacion_id=ORG_A, mes=OCTUBRE, suscripcion_id=SUSC_RESPALDO
        )

        assert pagina["count"] == 1
        assert pagina["results"][0]["suscripcion_id"] == SUSC_RESPALDO


# ══════════════════════════════════════════════════════════════════════
# Endpoint
# ══════════════════════════════════════════════════════════════════════

RUTA = "/api/analitica/resumen-uso/"


def _get(*, org: str | None = str(ORG_A), **params):
    return APIClient().get(
        RUTA,
        params,
        HTTP_X_ORGANIZACION_ID=org if org is not None else "",
    )


class TestResumenUsoEndpoint:
    def test_sin_contexto_de_organizacion_responde_403(self):
        respuesta = _get(org=None, mes=PERIODO_OCTUBRE)
        assert respuesta.status_code == 403

    def test_mes_faltante_responde_400(self):
        respuesta = _get()
        assert respuesta.status_code == 400
        assert "mes" in respuesta.data

    @pytest.mark.parametrize("mes", ["2026-13", "2026-1", "octubre", "2026-00"])
    def test_mes_invalido_responde_400(self, mes):
        respuesta = _get(mes=mes)
        assert respuesta.status_code == 400
        assert "mes" in respuesta.data

    def test_mes_futuro_responde_400(self):
        hoy = timezone.localdate()
        siguiente = (hoy.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
        respuesta = _get(mes=f"{siguiente:%Y-%m}")
        assert respuesta.status_code == 400
        assert "mes" in respuesta.data

    @pytest.mark.parametrize(
        "params",
        [
            {"page": "0"},
            {"page": "abc"},
            {"page_size": "0"},
            {"page_size": "101"},
            {"page_size": "abc"},
        ],
    )
    def test_paginacion_invalida_responde_400(self, params):
        respuesta = _get(mes=PERIODO_OCTUBRE, **params)
        assert respuesta.status_code == 400
        assert set(respuesta.data) & {"page", "page_size"}

    def test_suscripcion_id_invalido_responde_400(self):
        respuesta = _get(mes=PERIODO_OCTUBRE, suscripcion_id="no-es-uuid")
        assert respuesta.status_code == 400
        assert "suscripcion_id" in respuesta.data

    def test_sin_tablas_del_pipeline_degrada_a_sin_medicion(self, monkeypatch):
        """Sin esquema ``analytics`` la respuesta degrada, no falla.

        Se simula la ausencia de cada tabla con ``_tabla_existe`` para que la
        prueba valga igual en SQLite y en PostgreSQL: la degradación no puede
        depender del motor que corre la suite.
        """
        monkeypatch.setattr(resumen_uso, "_tabla_existe", lambda _: False)
        observar(suscripcion=SUSC_SIN_MEDICION, nombre="Sin pipeline")

        respuesta = _get(mes=PERIODO_OCTUBRE)

        assert respuesta.status_code == 200
        assert respuesta.data["periodo"] == PERIODO_OCTUBRE
        assert respuesta.data["count"] == 1
        fila = respuesta.data["results"][0]
        assert fila["cobertura"] == "sin_medicion"
        assert fila["estado_medicion"] == "sin_medicion"
        assert fila["uso_cero_observado"] is False
        assert fila["ms_netos"] == 0
        assert fila["minutos_netos"] == 0

    def test_pagina_valida_devuelve_el_sobre_documentado(self):
        respuesta = _get(mes=PERIODO_OCTUBRE, page=1, page_size=10)

        assert respuesta.status_code == 200
        assert respuesta.data == {
            "periodo": PERIODO_OCTUBRE,
            "count": 0,
            "next": None,
            "previous": None,
            "page": 1,
            "page_size": 10,
            "results": [],
        }

"""Pruebas de aceptación VI-25: exportación CSV de cobros.

La exportación debe respetar el rango inclusivo, exportar **todas** las filas
(no la página visible), aislar organizaciones y neutralizar fórmulas de hoja
de cálculo sin romper el formato numérico de los montos.
"""

import csv
from datetime import date
from decimal import Decimal
from io import StringIO
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.exportacion import COLUMNAS, escapar_formula_csv
from app.models import Cobro, Subscription


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


def crear_suscripcion(
    org_id: uuid.UUID,
    *,
    nombre: str = "Netflix",
    categoria: str = "streaming",
) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal("9990.00"),
        moneda="CLP",
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 3, 5),
        categoria=categoria,
    )


def crear_cobro(
    suscripcion: Subscription,
    fecha: date,
    monto: str = "9990.00",
    *,
    moneda: str = "CLP",
) -> Cobro:
    return Cobro.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        monto=Decimal(monto),
        moneda=moneda,
        fecha=fecha,
    )


def exportar(
    client: APIClient,
    org_id: uuid.UUID,
    *,
    desde: str = "2026-03-01",
    hasta: str = "2026-03-31",
    url: str = "/api/suscripciones/exportar-csv/",
    moneda: str | None = None,
    origen: str | None = None,
):
    consulta = f"desde={desde}&hasta={hasta}"
    if moneda is not None:
        consulta += f"&moneda={moneda}"
    if origen is not None:
        consulta += f"&origen={origen}"
    return client.get(
        f"{url}?{consulta}",
        headers={"X-Organizacion-Id": str(org_id)},
    )


def filas_csv(respuesta) -> list[list[str]]:
    contenido = respuesta.content.decode("utf-8")
    return list(csv.reader(StringIO(contenido)))


@pytest.mark.django_db
class TestRangoYContenido:
    def test_rango_inclusivo_y_columnas_exactas(self, client: APIClient) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 2, 28))
        primero = crear_cobro(suscripcion, date(2026, 3, 1), "1000.00")
        ultimo = crear_cobro(suscripcion, date(2026, 3, 31), "2000.00")
        crear_cobro(suscripcion, date(2026, 4, 1))

        respuesta = exportar(client, org)

        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta["Content-Type"].startswith("text/csv")
        assert "attachment" in respuesta["Content-Disposition"]
        filas = filas_csv(respuesta)
        assert tuple(filas[0]) == COLUMNAS
        assert len(filas) == 3  # encabezado + dos cobros inclusivos
        assert {fila[2] for fila in filas[1:]} == {"1000.00", "2000.00"}
        assert {fila[4] for fila in filas[1:]} == {
            primero.fecha.isoformat(),
            ultimo.fecha.isoformat(),
        }

    def test_exporta_todas_las_filas_aunque_haya_paginacion(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        for dia in range(1, 16):
            crear_cobro(suscripcion, date(2026, 3, dia))

        # La página por defecto tiene 10; la exportación no.
        respuesta = exportar(client, org, hasta="2026-03-31")

        filas = filas_csv(respuesta)
        assert len(filas) == 16
        assert len({fila[4] for fila in filas[1:]}) == 15

    def test_aislamiento_estricto_entre_organizaciones(
        self, client: APIClient
    ) -> None:
        org_a = uuid.uuid4()
        org_b = uuid.uuid4()
        propia = crear_suscripcion(org_a, nombre="Propia")
        ajena = crear_suscripcion(org_b, nombre="Ajena")
        crear_cobro(propia, date(2026, 3, 10))
        crear_cobro(ajena, date(2026, 3, 10))

        respuesta = exportar(client, org_a)

        filas = filas_csv(respuesta)
        assert len(filas) == 2
        assert filas[1][0] == "Propia"
        assert "Ajena" not in respuesta.content.decode("utf-8")

    def test_periodo_sin_cobros_devuelve_solo_encabezados(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        crear_suscripcion(org)

        respuesta = exportar(client, org)

        assert respuesta.status_code == status.HTTP_200_OK
        filas = filas_csv(respuesta)
        assert filas == [list(COLUMNAS)]

    def test_alias_api_export_cobros(self, client: APIClient) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 3, 10))

        respuesta = exportar(client, org, url="/api/export/cobros/")

        assert respuesta.status_code == status.HTTP_200_OK
        assert len(filas_csv(respuesta)) == 2


@pytest.mark.django_db
class TestSeguridadCSV:
    def test_neutraliza_formulas_en_celdas_de_texto_sin_tocar_el_monto(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(
            org,
            nombre='=HYPERLINK("http://ejemplo.invalido")',
            categoria="streaming",
        )
        crear_cobro(suscripcion, date(2026, 3, 10), "12990.00")

        respuesta = exportar(client, org)
        fila = filas_csv(respuesta)[1]

        assert fila[0] == '\'=HYPERLINK("http://ejemplo.invalido")'
        assert fila[1] == "streaming"
        # El monto sigue siendo numérico: no lleva apóstrofo.
        assert fila[2] == "12990.00"

    def test_escapar_formula_cubre_los_prefijos_peligrosos(self) -> None:
        for valor in ("=1+1", "+1", "-1", "@SUMA", "\t=1", "\r=1"):
            assert escapar_formula_csv(valor) == "'" + valor
        # Los valores numéricos y los textos normales no se tocan.
        assert escapar_formula_csv("12990.00") == "12990.00"
        assert escapar_formula_csv("Netflix") == "Netflix"

    def test_neutraliza_arroba_y_guion_inicial(self, client: APIClient) -> None:
        org = uuid.uuid4()
        at = crear_suscripcion(org, nombre="@usuario")
        guion = crear_suscripcion(org, nombre="-2+3")
        crear_cobro(at, date(2026, 3, 10))
        crear_cobro(guion, date(2026, 3, 11))

        filas = filas_csv(exportar(client, org))[1:]

        assert filas[0][0] == "'@usuario"
        assert filas[1][0] == "'-2+3"


@pytest.mark.django_db
class TestValidacionDeParametros:
    def test_falta_desde_responde_400(self, client: APIClient) -> None:
        org = uuid.uuid4()
        respuesta = client.get(
            "/api/suscripciones/exportar-csv/?hasta=2026-03-31",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert "desde" in respuesta.data

    def test_falta_hasta_responde_400(self, client: APIClient) -> None:
        org = uuid.uuid4()
        respuesta = client.get(
            "/api/suscripciones/exportar-csv/?desde=2026-03-01",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert "hasta" in respuesta.data

    def test_fecha_invalida_responde_400(self, client: APIClient) -> None:
        org = uuid.uuid4()
        respuesta = exportar(client, org, desde="2026-13-45")
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert "desde" in respuesta.data

    def test_rango_invertido_responde_400(self, client: APIClient) -> None:
        org = uuid.uuid4()
        respuesta = exportar(
            client,
            org,
            desde="2026-04-01",
            hasta="2026-03-01",
        )
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert "hasta" in respuesta.data

    def test_sin_cabecera_de_organizacion_responde_403(
        self, client: APIClient
    ) -> None:
        respuesta = client.get(
            "/api/suscripciones/exportar-csv/"
            "?desde=2026-03-01&hasta=2026-03-31"
        )
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestFiltrosMonedaYOrigen:
    RUTAS = ("/api/suscripciones/exportar-csv/", "/api/export/cobros/")

    def test_moneda_clp_solo_devuelve_clp(self, client: APIClient) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 3, 10), "10000.00", moneda="CLP")
        crear_cobro(suscripcion, date(2026, 3, 11), "10.00", moneda="USD")

        filas = filas_csv(exportar(client, org, moneda="CLP"))[1:]

        assert len(filas) == 1
        assert filas[0][3] == "CLP"
        assert filas[0][2] == "10000.00"

    def test_moneda_usd_solo_devuelve_usd(self, client: APIClient) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 3, 10), "10000.00", moneda="CLP")
        crear_cobro(suscripcion, date(2026, 3, 11), "10.00", moneda="USD")

        filas = filas_csv(exportar(client, org, moneda="usd"))[1:]

        assert len(filas) == 1
        assert filas[0][3] == "USD"

    @pytest.mark.parametrize("ruta", RUTAS)
    def test_moneda_fuera_del_catalogo_responde_400_en_ambas_rutas(
        self, client: APIClient, ruta: str
    ) -> None:
        org = uuid.uuid4()
        respuesta = exportar(client, org, url=ruta, moneda="XXX")

        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert "moneda" in respuesta.data

    @pytest.mark.parametrize("ruta", RUTAS)
    def test_origen_manual_es_aceptado_en_ambas_rutas(
        self, client: APIClient, ruta: str
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 3, 10))

        respuesta = exportar(client, org, url=ruta, origen="manual")

        assert respuesta.status_code == status.HTTP_200_OK
        filas = filas_csv(respuesta)[1:]
        assert len(filas) == 1
        assert filas[0][5] == "manual"

    @pytest.mark.parametrize("origen", ["csv", "correo", "pdf", "automatico"])
    @pytest.mark.parametrize("ruta", RUTAS)
    def test_origen_no_soportado_responde_400_en_ambas_rutas(
        self, client: APIClient, ruta: str, origen: str
    ) -> None:
        org = uuid.uuid4()
        respuesta = exportar(client, org, url=ruta, origen=origen)

        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert "origen" in respuesta.data

    def test_ambas_rutas_producen_el_mismo_csv_con_los_mismos_filtros(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 3, 10), "10000.00", moneda="CLP")
        crear_cobro(suscripcion, date(2026, 3, 11), "10.00", moneda="USD")

        canonica = exportar(
            client, org, url=self.RUTAS[0], moneda="CLP", origen="manual"
        )
        alias = exportar(
            client, org, url=self.RUTAS[1], moneda="CLP", origen="manual"
        )

        assert canonica.status_code == alias.status_code == status.HTTP_200_OK
        assert canonica.content == alias.content

    def test_filtros_se_combinan_con_rango_y_tenant(
        self, client: APIClient
    ) -> None:
        org_a = uuid.uuid4()
        org_b = uuid.uuid4()
        propia = crear_suscripcion(org_a, nombre="Propia")
        ajena = crear_suscripcion(org_b, nombre="Ajena")

        crear_cobro(propia, date(2026, 2, 28), "10000.00", moneda="CLP")
        crear_cobro(propia, date(2026, 3, 10), "10000.00", moneda="CLP")
        crear_cobro(propia, date(2026, 3, 11), "10.00", moneda="USD")
        crear_cobro(propia, date(2026, 4, 1), "10000.00", moneda="CLP")
        crear_cobro(ajena, date(2026, 3, 10), "10000.00", moneda="CLP")

        filas = filas_csv(
            exportar(client, org_a, moneda="CLP", origen="manual")
        )[1:]

        assert len(filas) == 1
        assert filas[0][0] == "Propia"
        assert filas[0][3] == "CLP"
        assert filas[0][4] == "2026-03-10"
        assert "Ajena" not in "\n".join(fila[0] for fila in filas)

    def test_filtro_exporta_mas_de_una_pagina(self, client: APIClient) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        for dia in range(1, 26):
            crear_cobro(
                suscripcion,
                date(2026, 3, dia),
                "10000.00",
                moneda="CLP" if dia % 2 else "USD",
            )

        filas = filas_csv(
            exportar(client, org, moneda="CLP", origen="manual")
        )[1:]

        # Días impares: 1, 3, …, 25 → 13 filas CLP, más que una página de 10.
        assert len(filas) == 13
        assert {fila[3] for fila in filas} == {"CLP"}


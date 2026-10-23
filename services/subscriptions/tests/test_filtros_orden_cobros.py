"""Pruebas de aceptación para:
- VI-01: Añadir búsqueda por nombre al listado.
- VI-02: Ordenar suscripciones en servidor.
- VI-04: Consultar historial de cobros por suscripción.
"""

from datetime import date, timedelta
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Cobro, Subscription


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def org_principal() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def org_ajena() -> uuid.UUID:
    return uuid.uuid4()


def crear_suscripcion(
    org_id: uuid.UUID,
    nombre: str,
    monto: str = "9.99",
    estado: str = "activo",
    fecha_cobro: date | None = None,
    frecuencia: str = "mensual",
) -> Subscription:
    if fecha_cobro is None:
        fecha_cobro = date(2026, 11, 15)
    return Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal(monto),
        moneda="CLP",
        frecuencia=frecuencia,
        fecha_proximo_cobro=fecha_cobro,
        estado=estado,
    )


# ══════════════════════════════════════════════════════════════════════
# VI-01: Búsqueda por nombre
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestBusquedaNombreVI01:
    """Verifica el filtro server-side por nombre en el listado."""

    def test_busqueda_parcial_insensible_a_mayusculas(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Netflix Premium")
        crear_suscripcion(org_principal, "Spotify Duo")
        crear_suscripcion(org_principal, "HBO Max")

        # Búsqueda minúsculas
        resp = client.get(
            "/api/suscripciones/?nombre=net",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["nombre"] == "Netflix Premium"

        # Búsqueda mayúsculas
        resp_mayus = client.get(
            "/api/suscripciones/?nombre=SPOT",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp_mayus.status_code == status.HTTP_200_OK
        assert resp_mayus.data["count"] == 1
        assert resp_mayus.data["results"][0]["nombre"] == "Spotify Duo"

    def test_busqueda_combinada_con_estado(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Netflix Activo", estado="activo")
        crear_suscripcion(org_principal, "Netflix Cancelado", estado="cancelado")

        resp = client.get(
            "/api/suscripciones/?nombre=netflix&estado=activo",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["nombre"] == "Netflix Activo"

    def test_cadena_vacia_o_espacios_equivale_a_no_filtrar(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Item 1")
        crear_suscripcion(org_principal, "Item 2")

        resp = client.get(
            "/api/suscripciones/?nombre=   ",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 2

    def test_aislamiento_tenant_en_busqueda(
        self, client: APIClient, org_principal: uuid.UUID, org_ajena: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Amazon Prime Propio")
        crear_suscripcion(org_ajena, "Amazon Prime Ajeno")

        resp = client.get(
            "/api/suscripciones/?nombre=amazon",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["nombre"] == "Amazon Prime Propio"

    def test_alias_search_compatible(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "GitHub Copilot")

        resp = client.get(
            "/api/suscripciones/?search=copilot",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1


# ══════════════════════════════════════════════════════════════════════
# VI-02: Ordenamiento server-side
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestOrdenamientoServidorVI02:
    """Verifica el ordenamiento server-side con allowlist."""

    def test_orden_numerico_por_monto(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Medio", monto="2000.00")
        crear_suscripcion(org_principal, "Barato", monto="100.50")
        crear_suscripcion(org_principal, "Caro", monto="15000.00")

        # Ascendente
        resp_asc = client.get(
            "/api/suscripciones/?orden=monto",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp_asc.status_code == status.HTTP_200_OK
        nombres_asc = [s["nombre"] for s in resp_asc.data["results"]]
        assert nombres_asc == ["Barato", "Medio", "Caro"]

        # Descendente
        resp_desc = client.get(
            "/api/suscripciones/?orden=-monto",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp_desc.status_code == status.HTTP_200_OK
        nombres_desc = [s["nombre"] for s in resp_desc.data["results"]]
        assert nombres_desc == ["Caro", "Medio", "Barato"]

    def test_orden_por_nombre_alfabetico(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Zeta")
        crear_suscripcion(org_principal, "Alfa")
        crear_suscripcion(org_principal, "Beta")

        resp = client.get(
            "/api/suscripciones/?orden=nombre",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        nombres = [s["nombre"] for s in resp.data["results"]]
        assert nombres == ["Alfa", "Beta", "Zeta"]

    def test_orden_por_fecha_proximo_cobro(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Pronto", fecha_cobro=date(2026, 11, 1))
        crear_suscripcion(org_principal, "Lejano", fecha_cobro=date(2026, 12, 1))

        resp = client.get(
            "/api/suscripciones/?orden=fecha_proximo_cobro",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["results"][0]["nombre"] == "Pronto"
        assert resp.data["results"][1]["nombre"] == "Lejano"

    def test_campo_no_permitido_se_rechaza_con_400(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        resp = client.get(
            "/api/suscripciones/?orden=password",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "orden" in resp.data

    def test_orden_vacio_no_rompe_listado(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        crear_suscripcion(org_principal, "Item")
        resp = client.get(
            "/api/suscripciones/?orden=",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1


# ══════════════════════════════════════════════════════════════════════
# VI-04: Historial de cobros por suscripción
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestHistorialCobrosVI04:
    """Verifica el endpoint GET /api/suscripciones/<id>/cobros/."""

    def test_obtiene_cobros_reales_ordenados_por_fecha_descendente(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Streaming", monto="10000.00")
        c1 = Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("9000.00"),
            moneda="CLP",
            fecha=date(2026, 8, 15),
        )
        c2 = Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("12000.00"),
            moneda="CLP",
            fecha=date(2026, 9, 15),
        )

        resp = client.get(
            f"/api/suscripciones/{suscripcion.id}/cobros/",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 2
        # Más reciente primero
        assert resp.data["results"][0]["id"] == str(c2.id)
        assert resp.data["results"][0]["monto"] == "12000.00"
        assert resp.data["results"][0]["hubo_alza"] is True
        assert resp.data["results"][1]["id"] == str(c1.id)
        assert resp.data["results"][1]["hubo_alza"] is False

    def test_aislamiento_tenant_retorna_404(
        self, client: APIClient, org_principal: uuid.UUID, org_ajena: uuid.UUID
    ) -> None:
        suscripcion_ajena = crear_suscripcion(org_ajena, "Ajena")
        Cobro.objects.create(
            organizacion_id=org_ajena,
            suscripcion=suscripcion_ajena,
            monto=Decimal("5000.00"),
            moneda="CLP",
            fecha=date(2026, 9, 1),
        )

        resp = client.get(
            f"/api/suscripciones/{suscripcion_ajena.id}/cobros/",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_editar_monto_suscripcion_no_altera_cobros_historicos(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Plan A", monto="5000.00")
        cobro = Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("5000.00"),
            moneda="CLP",
            fecha=date(2026, 9, 1),
        )

        # Modificamos monto de suscripción
        patch_resp = client.patch(
            f"/api/suscripciones/{suscripcion.id}/",
            {"monto": "8000.00"},
            format="json",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert patch_resp.status_code == status.HTTP_200_OK

        cobro.refresh_from_db()
        assert cobro.monto == Decimal("5000.00")

    def test_filtro_rango_fechas_en_cobros(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Gym", monto="30000.00")
        Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("30000.00"),
            moneda="CLP",
            fecha=date(2026, 7, 10),
        )
        Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("30000.00"),
            moneda="CLP",
            fecha=date(2026, 8, 10),
        )
        Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("30000.00"),
            moneda="CLP",
            fecha=date(2026, 9, 10),
        )

        resp = client.get(
            f"/api/suscripciones/{suscripcion.id}/cobros/?desde=2026-08-01&hasta=2026-08-31",
            headers={"X-Organizacion-Id": str(org_principal)},
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["fecha"] == "2026-08-10"

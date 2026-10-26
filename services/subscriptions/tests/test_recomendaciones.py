"""Pruebas de VI-17 (listado de recomendaciones) y VI-21 (umbral mínimo de ahorro).

Cubre:
- RN-REC-001: ahorros por debajo del umbral quedan excluidos (criterio principal).
- Umbral por defecto cuando no hay configuración en BD.
- Umbral desde BD activo e inactivo.
- Respuesta estructurada vacía cuando no hay sugerencias.
- Detección de uso bajo (motivo «uso_bajo»).
- Detección de duplicados por categoría (motivo «duplicado_categoria», VI-20).
- Sin duplicados por ID en la respuesta.
- Aislamiento multi-tenant: 403 sin X-Organizacion-Id.
- Suscripciones canceladas y soft-deleted excluidas.
- Sin errores 500 con datos inesperados (stub FE-29).
"""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Subscription, UmbralAhorro, umbral_minimo, UMBRAL_AHORRO_DEFAULT


# ── fixtures ──────────────────────────────────────────────────────────


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def org() -> uuid.UUID:
    return uuid.uuid4()


def _sub(
    org_id: uuid.UUID,
    nombre: str,
    monto: str = "9990.00",
    moneda: str = "CLP",
    categoria: str = "streaming",
    estado: str = Subscription.Estado.ACTIVO,
    horas_uso_mes=None,
    activo: bool = True,
) -> Subscription:
    """Helper: crea una suscripción con los parámetros dados."""
    sub = Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia="mensual",
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria=categoria,
        estado=estado,
        activo=activo,
        horas_uso_mes=Decimal(str(horas_uso_mes)) if horas_uso_mes is not None else None,
    )
    return sub


def _headers(org_id: uuid.UUID) -> dict:
    return {"X-Organizacion-Id": str(org_id)}


# ══════════════════════════════════════════════════════════════════════
# VI-21: Umbral mínimo de ahorro (RN-REC-001)
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestUmbralMinimo:
    """Valida la función umbral_minimo y el modelo UmbralAhorro."""

    def test_sin_configuracion_devuelve_default(self) -> None:
        """Sin fila en BD, umbral_minimo devuelve UMBRAL_AHORRO_DEFAULT (0.01)."""
        assert umbral_minimo("CLP") == UMBRAL_AHORRO_DEFAULT
        assert umbral_minimo("USD") == UMBRAL_AHORRO_DEFAULT

    def test_con_configuracion_activa_devuelve_monto(self) -> None:
        """Con fila activa, devuelve el monto configurado."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=True)
        assert umbral_minimo("CLP") == Decimal("5000.00")

    def test_con_configuracion_inactiva_devuelve_default(self) -> None:
        """Con fila inactiva, devuelve el default (como si no hubiera configuración)."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=False)
        assert umbral_minimo("CLP") == UMBRAL_AHORRO_DEFAULT

    def test_moneda_en_minusculas_normaliza_a_mayusculas(self) -> None:
        """La función acepta moneda en minúsculas y busca en mayúsculas."""
        UmbralAhorro.objects.create(moneda="USD", monto=Decimal("10.00"), activo=True)
        assert umbral_minimo("usd") == Decimal("10.00")

    def test_moneda_desconocida_devuelve_default(self) -> None:
        """Moneda sin configuración devuelve el default, no lanza excepción."""
        assert umbral_minimo("JPY") == UMBRAL_AHORRO_DEFAULT

    def test_umbral_es_determinista(self) -> None:
        """El mismo umbral produce el mismo resultado (RN-REC-001: determinismo)."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("3000.00"), activo=True)
        r1 = umbral_minimo("CLP")
        r2 = umbral_minimo("CLP")
        assert r1 == r2 == Decimal("3000.00")


# ══════════════════════════════════════════════════════════════════════
# VI-17: Endpoint GET /api/recommendations/
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestEndpointRecomendaciones:
    """Valida el contrato completo del endpoint GET /api/recommendations/."""

    def test_sin_organizacion_id_responde_403(self, client: APIClient) -> None:
        resp = client.get("/api/recommendations/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_sin_suscripciones_devuelve_estructura_vacia(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.status_code == status.HTTP_200_OK
        data = resp.data
        assert data["total"] == 0
        assert data["recomendaciones"] == []
        assert data["motivo_sin_sugerencias"] is not None
        assert str(org) == data["organizacion_id"]

    def test_estructura_de_respuesta_completa(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """La respuesta siempre incluye todos los campos del contrato."""
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.status_code == status.HTTP_200_OK
        campos = {
            "organizacion_id", "moneda", "umbral_aplicado",
            "total", "recomendaciones", "motivo_sin_sugerencias",
        }
        assert campos.issubset(set(resp.data.keys()))

    def test_umbral_aplicado_en_respuesta_usa_default_sin_config(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """umbral_aplicado refleja UMBRAL_AHORRO_DEFAULT cuando no hay config en BD."""
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.status_code == status.HTTP_200_OK
        assert Decimal(str(resp.data["umbral_aplicado"])) == UMBRAL_AHORRO_DEFAULT

    def test_umbral_aplicado_en_respuesta_usa_config_de_bd(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """umbral_aplicado refleja el valor configurado en BD."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=True)
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert Decimal(str(resp.data["umbral_aplicado"])) == Decimal("5000.00")


# ══════════════════════════════════════════════════════════════════════
# RN-REC-001: filtrado por umbral mínimo de ahorro
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestFiltradoUmbral:
    """Criterio central: ahorros por debajo del umbral se excluyen."""

    def test_ahorro_por_debajo_del_umbral_se_excluye(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Una suscripción con monto < umbral NO aparece en la lista (RN-REC-001)."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=True)
        # Monto 3000 < umbral 5000 → no debe aparecer aunque tenga uso 0
        _sub(org, "Pequeña", monto="3000.00", horas_uso_mes=0)

        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["total"] == 0
        assert resp.data["recomendaciones"] == []

    def test_ahorro_igual_al_umbral_se_incluye(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Un ahorro exactamente igual al umbral SÍ aparece (borde >=)."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=True)
        _sub(org, "Exacta", monto="5000.00", horas_uso_mes=0)

        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["total"] == 1

    def test_ahorro_por_encima_del_umbral_se_incluye(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Un ahorro mayor al umbral aparece en la lista."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=True)
        _sub(org, "Grande", monto="9990.00", horas_uso_mes=0)

        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["total"] == 1
        assert resp.data["recomendaciones"][0]["ahorro_estimado"] == "9990.00"

    def test_determinismo_en_el_borde_del_umbral(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Dos llamadas con los mismos datos producen el mismo resultado (RN-REC-001)."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=True)
        _sub(org, "Borde", monto="5000.00", horas_uso_mes=0)

        r1 = client.get("/api/recommendations/", headers=_headers(org))
        r2 = client.get("/api/recommendations/", headers=_headers(org))
        assert r1.data["total"] == r2.data["total"] == 1

    def test_mix_sobre_y_bajo_umbral_solo_muestra_los_que_superan(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Solo aparecen las suscripciones cuyo monto >= umbral."""
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("5000.00"), activo=True)
        _sub(org, "Visible", monto="9990.00", horas_uso_mes=0)
        _sub(org, "Oculta", monto="3000.00", horas_uso_mes=0)

        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.data["total"] == 1
        nombres = [r["nombre"] for r in resp.data["recomendaciones"]]
        assert "Visible" in nombres
        assert "Oculta" not in nombres


# ══════════════════════════════════════════════════════════════════════
# Reglas del motor de recomendaciones
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestReglasMotor:
    """Valida las reglas de negocio del motor de recomendaciones."""

    def test_uso_bajo_genera_recomendacion(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Suscripción con horas_uso_mes < 2 h genera recomendación «uso_bajo»."""
        _sub(org, "Netflix", monto="9990.00", horas_uso_mes=Decimal("1.00"))
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.data["total"] == 1
        rec = resp.data["recomendaciones"][0]
        assert rec["motivo"] == "uso_bajo"
        assert rec["nombre"] == "Netflix"

    def test_uso_suficiente_no_genera_recomendacion(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Suscripción con horas_uso_mes >= 2 h NO genera recomendación."""
        _sub(org, "Netflix", monto="9990.00", horas_uso_mes=Decimal("3.00"))
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.data["total"] == 0

    def test_duplicado_categoria_genera_recomendacion(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Dos suscripciones en la misma categoría generan «duplicado_categoria»."""
        _sub(org, "Netflix", monto="9990.00", categoria="streaming", horas_uso_mes=Decimal("5.00"))
        _sub(org, "Disney+", monto="5990.00", categoria="streaming", horas_uso_mes=Decimal("5.00"))

        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.data["total"] >= 1
        motivos = [r["motivo"] for r in resp.data["recomendaciones"]]
        assert "duplicado_categoria" in motivos

    def test_duplicado_categoria_solo_marca_las_redundantes_no_la_principal(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """La suscripción de mayor monto (principal) no aparece como redundante."""
        _sub(org, "Netflix", monto="9990.00", categoria="streaming", horas_uso_mes=Decimal("5.00"))
        _sub(org, "Disney+", monto="5990.00", categoria="streaming", horas_uso_mes=Decimal("5.00"))

        resp = client.get("/api/recommendations/", headers=_headers(org))
        nombres_recomendados = [r["nombre"] for r in resp.data["recomendaciones"]]
        # La redundante (menor monto) debe aparecer
        assert "Disney+" in nombres_recomendados
        # La principal (mayor monto) no debe aparecer como redundante
        assert "Netflix" not in nombres_recomendados

    def test_sin_duplicados_por_id(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Una suscripción que califica para dos reglas solo aparece una vez."""
        # Uso bajo Y categoría duplicada → solo debe aparecer una vez
        _sub(org, "Netflix", monto="9990.00", categoria="streaming", horas_uso_mes=Decimal("0.50"))
        _sub(org, "Disney+", monto="5990.00", categoria="streaming", horas_uso_mes=Decimal("5.00"))

        resp = client.get("/api/recommendations/", headers=_headers(org))
        ids = [r["suscripcion_id"] for r in resp.data["recomendaciones"]]
        assert len(ids) == len(set(ids)), "Hay IDs duplicados en la respuesta"

    def test_suscripcion_cancelada_no_genera_recomendacion(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Suscripciones canceladas quedan fuera del análisis."""
        _sub(org, "Cancelada", monto="9990.00", estado=Subscription.Estado.CANCELADO, horas_uso_mes=0)
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.data["total"] == 0

    def test_suscripcion_softdeleted_no_genera_recomendacion(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Suscripciones con activo=False quedan fuera del análisis."""
        _sub(org, "Eliminada", monto="9990.00", activo=False, horas_uso_mes=0)
        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.data["total"] == 0

    def test_stub_uso_cuando_horas_es_none(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Si horas_uso_mes es None (FE-29 no disponible), usa stub y no lanza 500."""
        # horas_uso_mes=None → stub = _HORAS_USO_BAJO_STUB = 2.00 h → no genera uso_bajo
        _sub(org, "Sin Uso", monto="9990.00", horas_uso_mes=None)
        resp = client.get("/api/recommendations/", headers=_headers(org))
        # No debe lanzar 500
        assert resp.status_code == status.HTTP_200_OK

    def test_filtro_por_moneda_query_param(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """El parámetro ?moneda filtra suscripciones por moneda correctamente."""
        _sub(org, "Netflix CLP", monto="9990.00", moneda="CLP", horas_uso_mes=0)
        _sub(org, "Netflix USD", monto="9.99", moneda="USD", horas_uso_mes=0)

        resp_clp = client.get("/api/recommendations/?moneda=CLP", headers=_headers(org))
        resp_usd = client.get("/api/recommendations/?moneda=USD", headers=_headers(org))

        nombres_clp = [r["nombre"] for r in resp_clp.data["recomendaciones"]]
        nombres_usd = [r["nombre"] for r in resp_usd.data["recomendaciones"]]

        assert "Netflix CLP" in nombres_clp
        assert "Netflix USD" not in nombres_clp
        assert "Netflix USD" in nombres_usd
        assert "Netflix CLP" not in nombres_usd

    def test_aislamiento_tenant_no_muestra_suscripciones_ajenas(
        self, client: APIClient
    ) -> None:
        """Las recomendaciones solo incluyen suscripciones del tenant autenticado."""
        org_a = uuid.uuid4()
        org_b = uuid.uuid4()
        _sub(org_a, "De A", monto="9990.00", horas_uso_mes=0)
        _sub(org_b, "De B", monto="9990.00", horas_uso_mes=0)

        resp = client.get("/api/recommendations/", headers=_headers(org_a))
        nombres = [r["nombre"] for r in resp.data["recomendaciones"]]
        assert "De A" in nombres
        assert "De B" not in nombres

    def test_respuesta_vacia_cuando_todas_superan_el_umbral_de_uso(
        self, client: APIClient, org: uuid.UUID
    ) -> None:
        """Si todas las suscripciones tienen uso suficiente, la lista es vacía."""
        _sub(org, "Activa 1", monto="9990.00", horas_uso_mes=Decimal("5.00"))
        _sub(org, "Activa 2", monto="5990.00", categoria="musica", horas_uso_mes=Decimal("10.00"))

        resp = client.get("/api/recommendations/", headers=_headers(org))
        assert resp.data["total"] == 0
        assert resp.data["recomendaciones"] == []
        assert resp.data["motivo_sin_sugerencias"] is not None

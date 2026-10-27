"""Pruebas de aceptación para VI-18: Descartar recomendaciones.

Criterios de aceptación:
- [x] Descartar dos veces no falla ni reaparece inmediatamente (idempotencia y exclusión de lista).
- [x] Una cuenta no modifica recomendaciones de otra (ownership real / multi-tenant).
- [x] Vigencia ante futuras recalculaciones (respeto de expiración temporal).
- [x] Validación de cabeceras de contexto (403 sin X-Organizacion-Id).
- [x] Registro auditable del actor que descartó (X-Usuario-Id).
"""

from datetime import date, timedelta
from decimal import Decimal
import uuid

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from app.models import RecomendacionDescartada, Subscription


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def org_a() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def org_b() -> uuid.UUID:
    return uuid.uuid4()


def _crear_suscripcion_recomendable(
    org_id: uuid.UUID,
    nombre: str = "Streaming Sub",
    monto: str = "9990.00",
    moneda: str = "CLP",
    horas_uso: Decimal = Decimal("0.50"),
) -> Subscription:
    """Crea una suscripción activa con uso bajo para que genere recomendación."""
    return Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia="mensual",
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria="streaming",
        estado=Subscription.Estado.ACTIVO,
        horas_uso_mes=horas_uso,
    )


# ══════════════════════════════════════════════════════════════════════
# Criterio 1: Idempotencia y no reaparición inmediata
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestIdempotenciaYNoReaparicion:
    """Verifica que descartar dos veces sea idempotente y que no reaparezca inmediatamente."""

    def test_descartar_dos_veces_es_idempotente_y_no_falla(
        self, client: APIClient, org_a: uuid.UUID
    ) -> None:
        sub = _crear_suscripcion_recomendable(org_a, "Netflix")
        headers = {
            "X-Organizacion-Id": str(org_a),
            "X-Usuario-Id": "42",
        }

        # Primer descarte
        resp1 = client.post(
            f"/api/recommendations/{sub.id}/dismiss/",
            {"motivo": "no me interesa cambiar"},
            format="json",
            headers=headers,
        )
        assert resp1.status_code == status.HTTP_200_OK
        assert resp1.data["descartado"] is True
        assert resp1.data["suscripcion_id"] == str(sub.id)
        assert resp1.data["motivo"] == "no me interesa cambiar"
        assert resp1.data["descartado_por"] == 42
        assert RecomendacionDescartada.objects.filter(suscripcion=sub).count() == 1

        # Segundo descarte (idempotente)
        resp2 = client.post(
            f"/api/recommendations/{sub.id}/dismiss/",
            {"motivo": "confirmación de descarte"},
            format="json",
            headers=headers,
        )
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["descartado"] is True
        # No duplica registros en base de datos
        assert RecomendacionDescartada.objects.filter(suscripcion=sub).count() == 1

    def test_recomendacion_descartada_no_reaparece_inmediatamente(
        self, client: APIClient, org_a: uuid.UUID
    ) -> None:
        sub = _crear_suscripcion_recomendable(org_a, "Spotify")
        headers = {"X-Organizacion-Id": str(org_a)}

        # 1. Antes de descartar: aparece en las recomendaciones
        resp_antes = client.get("/api/recommendations/", headers=headers)
        assert resp_antes.status_code == status.HTTP_200_OK
        nombres_antes = [r["nombre"] for r in resp_antes.data["recomendaciones"]]
        assert "Spotify" in nombres_antes

        # 2. Descartar
        resp_dismiss = client.post(
            f"/api/recommendations/{sub.id}/dismiss/",
            headers=headers,
        )
        assert resp_dismiss.status_code == status.HTTP_200_OK

        # 3. Inmediatamente después: ya NO aparece en las recomendaciones
        resp_despues = client.get("/api/recommendations/", headers=headers)
        assert resp_despues.status_code == status.HTTP_200_OK
        nombres_despues = [r["nombre"] for r in resp_despues.data["recomendaciones"]]
        assert "Spotify" not in nombres_despues

    def test_descartar_una_conserva_las_demas_recomendaciones(
        self, client: APIClient, org_a: uuid.UUID
    ) -> None:
        sub1 = _crear_suscripcion_recomendable(org_a, "Sub 1")
        sub2 = _crear_suscripcion_recomendable(org_a, "Sub 2")
        headers = {"X-Organizacion-Id": str(org_a)}

        # Descartar solo sub1
        client.post(f"/api/recommendations/{sub1.id}/dismiss/", headers=headers)

        resp = client.get("/api/recommendations/", headers=headers)
        nombres = [r["nombre"] for r in resp.data["recomendaciones"]]
        assert "Sub 1" not in nombres
        assert "Sub 2" in nombres


# ══════════════════════════════════════════════════════════════════════
# Criterio 2: Ownership real (aislamiento multi-tenant)
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestOwnershipMultiTenant:
    """Verifica que una cuenta no pueda modificar ni descartar recomendaciones de otra."""

    def test_una_cuenta_no_puede_descartar_recomendacion_de_otra(
        self, client: APIClient, org_a: uuid.UUID, org_b: uuid.UUID
    ) -> None:
        sub_b = _crear_suscripcion_recomendable(org_b, "Suscripcion de B")
        headers_a = {"X-Organizacion-Id": str(org_a)}

        # Org A intenta descartar la recomendación de Org B
        resp = client.post(
            f"/api/recommendations/{sub_b.id}/dismiss/",
            headers=headers_a,
        )
        assert resp.status_code == status.HTTP_404_NOT_FOUND

        # Verificar que en la BD de Org B no se haya descartado nada
        assert RecomendacionDescartada.objects.filter(suscripcion=sub_b).count() == 0

        # Para Org B la recomendación sigue activa y visible
        resp_b = client.get("/api/recommendations/", headers={"X-Organizacion-Id": str(org_b)})
        nombres_b = [r["nombre"] for r in resp_b.data["recomendaciones"]]
        assert "Suscripcion de B" in nombres_b

    def test_descartar_sin_organizacion_id_responde_403(
        self, client: APIClient, org_a: uuid.UUID
    ) -> None:
        sub = _crear_suscripcion_recomendable(org_a, "Sin Org")
        resp = client.post(f"/api/recommendations/{sub.id}/dismiss/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_descartar_id_inexistente_responde_404(
        self, client: APIClient, org_a: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_a)}
        resp = client.post(f"/api/recommendations/{uuid.uuid4()}/dismiss/", headers=headers)
        assert resp.status_code == status.HTTP_404_NOT_FOUND


# ══════════════════════════════════════════════════════════════════════
# Criterio 3: Vigencia ante futuras recalculaciones
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestVigenciaRecalculacion:
    """Verifica que el descarte respete la vigencia temporal."""

    def test_descarte_con_vigencia_personalizada(
        self, client: APIClient, org_a: uuid.UUID
    ) -> None:
        sub = _crear_suscripcion_recomendable(org_a, "Canva")
        headers = {"X-Organizacion-Id": str(org_a)}

        resp = client.post(
            f"/api/recommendations/{sub.id}/dismiss/",
            {"dias_vigencia": 60, "motivo": "usamos canva para eventos anuales"},
            format="json",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        descarte = RecomendacionDescartada.objects.get(suscripcion=sub)
        assert descarte.motivo == "usamos canva para eventos anuales"
        dias_restantes = (descarte.vigente_hasta - timezone.now()).days
        assert 58 <= dias_restantes <= 61

    def test_recomendacion_reaparece_cuando_la_vigencia_del_descarte_expira(
        self, client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Si la vigencia del descarte ha expirado en el tiempo, vuelve a aparecer en la recalculación."""
        sub = _crear_suscripcion_recomendable(org_a, "Photoshop")
        headers = {"X-Organizacion-Id": str(org_a)}

        # Crear un descarte que expiró ayer
        RecomendacionDescartada.objects.create(
            organizacion_id=org_a,
            suscripcion=sub,
            motivo="descarte antiguo",
            vigente_hasta=timezone.now() - timedelta(days=1),
        )

        # En la recalculación, como ya expiró, debe volver a aparecer
        resp = client.get("/api/recommendations/", headers=headers)
        assert resp.status_code == status.HTTP_200_OK
        nombres = [r["nombre"] for r in resp.data["recomendaciones"]]
        assert "Photoshop" in nombres

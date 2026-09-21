"""Tests para endpoints de Subscription (PUT, PATCH, DELETE y aislamiento tenant)."""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Subscription


@pytest.fixture()
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture()
def org_a() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def org_b() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def subscription_org_a(org_a: uuid.UUID) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=org_a,
        nombre="Netflix",
        monto=Decimal("12990.00"),
        moneda="CLP",
        frecuencia="mensual",
        fecha_proximo_cobro=date(2026, 10, 1),
        categoria="streaming",
        estado="activo",
    )


@pytest.mark.django_db
class TestSubscriptionUpdateDeleteViews:
    """Pruebas de modificación y eliminación con aislamiento por organización."""

    def test_patch_subscription_success(
        self, api_client: APIClient, org_a: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """PATCH /subscriptions/<id>/ con estado 'cancelado' responde 200 y actualiza."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        response = api_client.patch(
            url,
            {"estado": "cancelado"},
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["estado"] == "cancelado"

        subscription_org_a.refresh_from_db()
        assert subscription_org_a.estado == "cancelado"

    def test_patch_subscription_supports_cancelada_normalization(
        self, api_client: APIClient, org_a: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """PATCH /subscriptions/<id>/ con 'cancelada' (ejemplo de la tarjeta) normaliza a 'cancelado'."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        response = api_client.patch(
            url,
            {"estado": "cancelada"},
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["estado"] == "cancelado"

        subscription_org_a.refresh_from_db()
        assert subscription_org_a.estado == "cancelado"

    def test_put_subscription_success(
        self, api_client: APIClient, org_a: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """PUT /subscriptions/<id>/ actualiza completamente el recurso y responde 200."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        put_payload = {
            "nombre": "Spotify Premium",
            "monto": "4500.00",
            "moneda": "CLP",
            "frecuencia": "mensual",
            "fecha_proximo_cobro": "2026-11-01",
            "categoria": "musica",
            "estado": "activo",
        }
        response = api_client.put(
            url,
            put_payload,
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["nombre"] == "Spotify Premium"
        assert Decimal(response.data["monto"]) == Decimal("4500.00")

        subscription_org_a.refresh_from_db()
        assert subscription_org_a.nombre == "Spotify Premium"
        assert subscription_org_a.monto == Decimal("4500.00")

    def test_delete_subscription_success(
        self, api_client: APIClient, org_a: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """DELETE /subscriptions/<id>/ elimina el recurso y responde 204."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        response = api_client.delete(
            url,
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Subscription.objects.filter(id=subscription_org_a.id).exists()

    def test_tenant_isolation_patch_from_other_account_returns_404(
        self, api_client: APIClient, org_b: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """Si otra cuenta/organización intenta modificar la suscripción, responde 404 sin revelar datos."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        response = api_client.patch(
            url,
            {"estado": "cancelado"},
            format="json",
            headers={"X-Organizacion-Id": str(org_b)},
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

        subscription_org_a.refresh_from_db()
        assert subscription_org_a.estado == "activo"

    def test_tenant_isolation_delete_from_other_account_returns_404(
        self, api_client: APIClient, org_b: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """Si otra cuenta/organización intenta eliminar la suscripción, responde 404."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        response = api_client.delete(
            url,
            headers={"X-Organizacion-Id": str(org_b)},
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert Subscription.objects.filter(id=subscription_org_a.id).exists()

    def test_request_missing_organization_header_returns_403(
        self, api_client: APIClient, subscription_org_a: Subscription
    ) -> None:
        """Peticiones sin X-Organizacion-Id deben responder 403 Forbidden."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        response = api_client.patch(
            url,
            {"estado": "cancelado"},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_cannot_reassign_organization_via_payload(
        self, api_client: APIClient, org_a: uuid.UUID, org_b: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """No se permite reasignar el organizacion_id desde el cuerpo de la petición."""
        url = f"/subscriptions/{subscription_org_a.id}/"
        response = api_client.patch(
            url,
            {"organizacion_id": str(org_b)},
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK

        subscription_org_a.refresh_from_db()
        assert subscription_org_a.organizacion_id == org_a

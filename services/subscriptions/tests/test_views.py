"""Tests para endpoints de Subscription (CRUD completo y aislamiento tenant)."""

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


@pytest.mark.django_db
class TestSubscriptionCreateListViews:
    """Pruebas de creación (POST) y listado (GET) con aislamiento por organización."""

    # ── helpers ──────────────────────────────────────────────────────

    VALID_PAYLOAD: dict = {
        "nombre": "Netflix",
        "monto": "9990.00",
        "moneda": "CLP",
        "frecuencia": "mensual",
        "fecha_proximo_cobro": "2026-10-01",
        "categoria": "streaming",
        "estado": "activo",
    }

    # ── POST /subscriptions/ ────────────────────────────────────────

    def test_create_subscription_success(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """POST /subscriptions/ con payload válido responde 201 y asigna organizacion_id de la cabecera."""
        response = api_client.post(
            "/subscriptions/",
            self.VALID_PAYLOAD,
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["nombre"] == "Netflix"
        assert response.data["moneda"] == "CLP"
        assert response.data["organizacion_id"] == str(org_a)
        # Verificar que existe en BD
        assert Subscription.objects.filter(id=response.data["id"]).exists()

    def test_create_subscription_with_legacy_card_aliases(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """POST con nombres legacy de la tarjeta Trello (ciclo, fecha_cobro) funciona correctamente."""
        legacy_payload = {
            "nombre": "Netflix",
            "monto": "9990.00",
            "moneda": "CLP",
            "ciclo": "mensual",           # alias → frecuencia
            "fecha_cobro": "2026-10-01",  # alias → fecha_proximo_cobro
            "categoria": "streaming",
            "estado": "activo",
        }
        response = api_client.post(
            "/subscriptions/",
            legacy_payload,
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["frecuencia"] == "mensual"
        assert response.data["fecha_proximo_cobro"] == "2026-10-01"

    def test_create_subscription_ignores_payload_organization(
        self, api_client: APIClient, org_a: uuid.UUID, org_b: uuid.UUID
    ) -> None:
        """El organizacion_id del body es ignorado; se asigna el de la cabecera."""
        payload_with_org = {**self.VALID_PAYLOAD, "organizacion_id": str(org_b)}
        response = api_client.post(
            "/subscriptions/",
            payload_with_org,
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_201_CREATED
        # organizacion_id viene de la cabecera (org_a), no del body (org_b)
        assert response.data["organizacion_id"] == str(org_a)

    def test_create_subscription_missing_header_returns_403(
        self, api_client: APIClient
    ) -> None:
        """POST sin cabecera X-Organizacion-Id responde 403 Forbidden."""
        response = api_client.post(
            "/subscriptions/",
            self.VALID_PAYLOAD,
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_create_subscription_invalid_monto_returns_400(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """POST con monto <= 0 responde 400 Bad Request."""
        invalid_payload = {**self.VALID_PAYLOAD, "monto": "-100.00"}
        response = api_client.post(
            "/subscriptions/",
            invalid_payload,
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    # ── GET /subscriptions/ ─────────────────────────────────────────

    def test_list_subscriptions_only_returns_own_tenant(
        self, api_client: APIClient, org_a: uuid.UUID, org_b: uuid.UUID
    ) -> None:
        """GET /subscriptions/ devuelve exclusivamente las suscripciones de la organización autenticada."""
        # Crear suscripciones para dos organizaciones
        Subscription.objects.create(
            organizacion_id=org_a,
            nombre="Netflix A",
            monto=Decimal("9990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 10, 1),
            categoria="streaming",
            estado="activo",
        )
        Subscription.objects.create(
            organizacion_id=org_b,
            nombre="Spotify B",
            monto=Decimal("4990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 10, 1),
            categoria="musica",
            estado="activo",
        )

        # Org A solo ve sus propias suscripciones
        resp_a = api_client.get(
            "/subscriptions/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert resp_a.status_code == status.HTTP_200_OK
        items_a = resp_a.data["results"] if isinstance(resp_a.data, dict) and "results" in resp_a.data else resp_a.data
        nombres_a = [s["nombre"] for s in items_a]
        assert "Netflix A" in nombres_a
        assert "Spotify B" not in nombres_a

        # Org B solo ve sus propias suscripciones
        resp_b = api_client.get(
            "/subscriptions/",
            headers={"X-Organizacion-Id": str(org_b)},
        )
        assert resp_b.status_code == status.HTTP_200_OK
        items_b = resp_b.data["results"] if isinstance(resp_b.data, dict) and "results" in resp_b.data else resp_b.data
        nombres_b = [s["nombre"] for s in items_b]
        assert "Spotify B" in nombres_b
        assert "Netflix A" not in nombres_b

    def test_list_subscriptions_missing_header_returns_403(
        self, api_client: APIClient
    ) -> None:
        """GET /subscriptions/ sin cabecera responde 403 Forbidden."""
        response = api_client.get("/subscriptions/")
        assert response.status_code == status.HTTP_403_FORBIDDEN

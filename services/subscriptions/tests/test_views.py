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
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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

    def test_put_ignores_horas_uso_y_ultima_actividad(
        self, api_client: APIClient, org_a: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """PUT no debe permitir modificar horas_uso_mes ni ultima_actividad directamente."""
        url = f"/api/suscripciones/{subscription_org_a.id}/"
        put_payload = {
            "nombre": "Spotify Premium",
            "monto": "4500.00",
            "moneda": "CLP",
            "frecuencia": "mensual",
            "fecha_proximo_cobro": "2026-11-01",
            "categoria": "musica",
            "estado": "activo",
            "horas_uso_mes": "999.00",
            "ultima_actividad": "2026-01-01T00:00:00Z",
        }
        response = api_client.put(
            url,
            put_payload,
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK

        subscription_org_a.refresh_from_db()
        assert subscription_org_a.horas_uso_mes is None or subscription_org_a.horas_uso_mes != Decimal("999.00")
        assert subscription_org_a.ultima_actividad is None

    def test_patch_ignores_horas_uso_y_ultima_actividad(
        self, api_client: APIClient, org_a: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """PATCH no debe permitir manipular horas_uso_mes ni ultima_actividad (son read_only)."""
        url = f"/api/suscripciones/{subscription_org_a.id}/"
        response = api_client.patch(
            url,
            {
                "horas_uso_mes": "500.00",
                "ultima_actividad": "2026-01-01T00:00:00Z",
            },
            format="json",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK

        subscription_org_a.refresh_from_db()
        assert subscription_org_a.horas_uso_mes is None or subscription_org_a.horas_uso_mes != Decimal("500.00")
        assert subscription_org_a.ultima_actividad is None

    def test_delete_subscription_success(
        self, api_client: APIClient, org_a: uuid.UUID, subscription_org_a: Subscription
    ) -> None:
        """DELETE /subscriptions/<id>/ elimina el recurso y responde 204."""
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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
        url = f"/api/suscripciones/{subscription_org_a.id}/"
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
            "/api/suscripciones/",
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
            "/api/suscripciones/",
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
            "/api/suscripciones/",
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
            "/api/suscripciones/",
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
            "/api/suscripciones/",
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
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert resp_a.status_code == status.HTTP_200_OK
        items_a = resp_a.data["results"] if isinstance(resp_a.data, dict) and "results" in resp_a.data else resp_a.data
        nombres_a = [s["nombre"] for s in items_a]
        assert "Netflix A" in nombres_a
        assert "Spotify B" not in nombres_a

        # Org B solo ve sus propias suscripciones
        resp_b = api_client.get(
            "/api/suscripciones/",
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
        response = api_client.get("/api/suscripciones/")
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestSubscriptionFilters:
    """Pruebas del filtrado por estado y fecha_cobro en GET /api/suscripciones/."""

    # ── fixtures de datos ────────────────────────────────────────────

    @pytest.fixture()
    def org(self) -> uuid.UUID:
        return uuid.uuid4()

    @pytest.fixture()
    def sub_activa(self, org: uuid.UUID) -> Subscription:
        return Subscription.objects.create(
            organizacion_id=org,
            nombre="Netflix",
            monto=Decimal("9990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 10, 1),
            categoria="streaming",
            estado="activo",
        )

    @pytest.fixture()
    def sub_cancelada(self, org: uuid.UUID) -> Subscription:
        return Subscription.objects.create(
            organizacion_id=org,
            nombre="Spotify",
            monto=Decimal("4990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 11, 1),
            categoria="musica",
            estado="cancelado",
        )

    @pytest.fixture()
    def sub_activa_otra_fecha(self, org: uuid.UUID) -> Subscription:
        return Subscription.objects.create(
            organizacion_id=org,
            nombre="Adobe CC",
            monto=Decimal("25000.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 11, 15),
            categoria="productividad",
            estado="activo",
        )

    # ── helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _nombres(response) -> list[str]:
        items = (
            response.data["results"]
            if isinstance(response.data, dict) and "results" in response.data
            else response.data
        )
        return [s["nombre"] for s in items]

    # ── tests: filtro por estado ─────────────────────────────────────

    def test_filter_estado_activo_devuelve_solo_activas(
        self,
        api_client: APIClient,
        org: uuid.UUID,
        sub_activa: Subscription,
        sub_cancelada: Subscription,
        sub_activa_otra_fecha: Subscription,
    ) -> None:
        """GET ?estado=activo devuelve solo suscripciones con estado 'activo'."""
        response = api_client.get(
            "/api/suscripciones/?estado=activo",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        nombres = self._nombres(response)
        assert "Netflix" in nombres
        assert "Adobe CC" in nombres
        assert "Spotify" not in nombres

    def test_filter_estado_cancelado_devuelve_solo_canceladas(
        self,
        api_client: APIClient,
        org: uuid.UUID,
        sub_activa: Subscription,
        sub_cancelada: Subscription,
    ) -> None:
        """GET ?estado=cancelado devuelve solo suscripciones canceladas."""
        response = api_client.get(
            "/api/suscripciones/?estado=cancelado",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        nombres = self._nombres(response)
        assert "Spotify" in nombres
        assert "Netflix" not in nombres

    def test_filter_estado_invalido_devuelve_lista_vacia(
        self,
        api_client: APIClient,
        org: uuid.UUID,
        sub_activa: Subscription,
    ) -> None:
        """GET ?estado=inexistente devuelve lista vacía (no error)."""
        response = api_client.get(
            "/api/suscripciones/?estado=inexistente",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(self._nombres(response)) == 0

    # ── tests: filtro por fecha de cobro ─────────────────────────────

    def test_filter_fecha_cobro_alias_devuelve_solo_coincidentes(
        self,
        api_client: APIClient,
        org: uuid.UUID,
        sub_activa: Subscription,
        sub_cancelada: Subscription,
        sub_activa_otra_fecha: Subscription,
    ) -> None:
        """GET ?fecha_cobro=2026-10-01 (alias de la tarjeta) filtra por fecha_proximo_cobro."""
        response = api_client.get(
            "/api/suscripciones/?fecha_cobro=2026-10-01",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        nombres = self._nombres(response)
        assert "Netflix" in nombres
        assert "Spotify" not in nombres
        assert "Adobe CC" not in nombres

    def test_filter_fecha_proximo_cobro_param_devuelve_coincidentes(
        self,
        api_client: APIClient,
        org: uuid.UUID,
        sub_activa: Subscription,
        sub_cancelada: Subscription,
    ) -> None:
        """GET ?fecha_proximo_cobro=2026-11-01 filtra por el nombre canónico del campo."""
        response = api_client.get(
            "/api/suscripciones/?fecha_proximo_cobro=2026-11-01",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        nombres = self._nombres(response)
        assert "Spotify" in nombres
        assert "Netflix" not in nombres

    # ── tests: filtro combinado ───────────────────────────────────────

    def test_filter_estado_y_fecha_combinados(
        self,
        api_client: APIClient,
        org: uuid.UUID,
        sub_activa: Subscription,
        sub_cancelada: Subscription,
        sub_activa_otra_fecha: Subscription,
    ) -> None:
        """GET ?estado=activo&fecha_cobro=2026-10-01 aplica ambos filtros a la vez."""
        response = api_client.get(
            "/api/suscripciones/?estado=activo&fecha_cobro=2026-10-01",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        nombres = self._nombres(response)
        assert "Netflix" in nombres
        assert "Adobe CC" not in nombres   # distinta fecha
        assert "Spotify" not in nombres    # distinto estado

    # ── tests: los filtros respetan el aislamiento tenant ────────────

    def test_filtro_estado_no_devuelve_datos_de_otro_tenant(
        self,
        api_client: APIClient,
        org: uuid.UUID,
        sub_activa: Subscription,
    ) -> None:
        """?estado=activo nunca revela suscripciones de otra organización."""
        otra_org = uuid.uuid4()
        Subscription.objects.create(
            organizacion_id=otra_org,
            nombre="Disney+ (otra org)",
            monto=Decimal("7990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 10, 1),
            categoria="streaming",
            estado="activo",
        )
        response = api_client.get(
            "/api/suscripciones/?estado=activo",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        nombres = self._nombres(response)
        assert "Disney+ (otra org)" not in nombres
        assert "Netflix" in nombres

    def test_filter_fecha_invalida_devuelve_400(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Una fecha mal escrita responde 400, no revienta con 500."""
        response = api_client.get(
            "/api/suscripciones/?fecha_cobro=hola",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_detalle_ignora_los_query_params_del_listado(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Un filtro colgado en la URL de detalle no debe esconder el recurso."""
        response = api_client.get(
            f"/api/suscripciones/{sub_activa.id}/?estado=cancelado",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestSubscriptionRegistrarUso:
    """Pruebas del endpoint POST /subscriptions/<id>/uso/ (CU-23 / RF-15 / RF-16)."""

    @pytest.fixture()
    def org(self) -> uuid.UUID:
        return uuid.uuid4()

    @pytest.fixture()
    def sub_activa(self, org: uuid.UUID) -> Subscription:
        return Subscription.objects.create(
            organizacion_id=org,
            nombre="Netflix",
            monto=Decimal("9990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 10, 1),
            categoria="streaming",
            estado="activo",
            horas_uso_mes=Decimal("0.00"),
        )

    @pytest.fixture()
    def sub_fantasma(self, org: uuid.UUID) -> Subscription:
        return Subscription.objects.create(
            organizacion_id=org,
            nombre="Gimnasio",
            monto=Decimal("19990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 10, 15),
            categoria="salud",
            estado="fantasma",
            horas_uso_mes=Decimal("0.00"),
        )

    def test_registrar_uso_minutos_negativos_devuelve_400(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Envía {"minutos": -10} y confirma 400 Bad Request."""
        response = api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": -10},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_registrar_uso_minutos_cero_devuelve_400(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Envía {"minutos": 0} y confirma 400 Bad Request."""
        response = api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": 0},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_registrar_uso_payload_vacio_devuelve_400(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Petición sin minutos devuelve 400 Bad Request."""
        response = api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_registrar_uso_actualiza_ultima_actividad_y_horas(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Envía {"minutos": 30}; actualiza ultima_actividad y horas_uso_mes."""
        assert sub_activa.ultima_actividad is None
        response = api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": 30},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK

        sub_activa.refresh_from_db()
        assert sub_activa.ultima_actividad is not None
        # 30 minutos = 0.50 horas
        assert sub_activa.horas_uso_mes == Decimal("0.50")
        assert response.data["horas_uso_mes"] == "0.50"
        assert response.data["ultima_actividad"] is not None

    def test_registrar_uso_reactiva_suscripcion_fantasma_a_activo(
        self, api_client: APIClient, org: uuid.UUID, sub_fantasma: Subscription
    ) -> None:
        """Envía {"minutos": 30} sobre suscripción Fantasma y confirma que vuelve a Activo."""
        assert sub_fantasma.estado == "fantasma"
        response = api_client.post(
            f"/api/suscripciones/{sub_fantasma.id}/uso/",
            {"minutos": 30},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["estado"] == "activo"

        sub_fantasma.refresh_from_db()
        assert sub_fantasma.estado == "activo"
        assert sub_fantasma.ultima_actividad is not None
        assert sub_fantasma.horas_uso_mes == Decimal("0.50")

    def test_registrar_uso_acumula_horas_de_uso(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Múltiples registros de uso acumulan horas_uso_mes correctamente."""
        # 1er registro: 30 minutos (0.50 horas)
        api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": 30},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        # 2do registro: 60 minutos (1.00 hora)
        api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": 60},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        sub_activa.refresh_from_db()
        assert sub_activa.horas_uso_mes == Decimal("1.50")

    def test_registrar_uso_aislamiento_tenant_otra_org_devuelve_404(
        self, api_client: APIClient, sub_activa: Subscription
    ) -> None:
        """Otra organización recibe 404 Not Found si intenta registrar uso."""
        otra_org = uuid.uuid4()
        response = api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": 30},
            format="json",
            headers={"X-Organizacion-Id": str(otra_org)},
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_registrar_uso_sin_cabecera_devuelve_403(
        self, api_client: APIClient, sub_activa: Subscription
    ) -> None:
        """Petición sin cabecera X-Organizacion-Id responde 403 Forbidden."""
        response = api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": 30},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_registrar_uso_soporta_ruta_subscriptions_ingles(
        self, api_client: APIClient, org: uuid.UUID, sub_fantasma: Subscription
    ) -> None:
        """POST /subscriptions/<id>/uso/ (ruta de la tarjeta Trello) funciona correctamente."""
        response = api_client.post(
            f"/subscriptions/{sub_fantasma.id}/uso/",
            {"minutos": 30},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["estado"] == "activo"

    def test_registrar_uso_minutos_excede_maximo_devuelve_400(
        self, api_client: APIClient, org: uuid.UUID, sub_activa: Subscription
    ) -> None:
        """Envía minutos por encima del tope mensual (> 44640) y confirma 400 Bad Request."""
        response = api_client.post(
            f"/api/suscripciones/{sub_activa.id}/uso/",
            {"minutos": 44641},
            format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "minutos" in response.data


@pytest.mark.django_db
class TestSubscriptionPagination:
    """Pruebas de paginación para GET /subscriptions/ y GET /api/suscripciones/."""

    @pytest.fixture()
    def org(self) -> uuid.UUID:
        return uuid.uuid4()

    @pytest.fixture()
    def org_otra(self) -> uuid.UUID:
        return uuid.uuid4()

    def _crear_lote_suscripciones(self, org_id: uuid.UUID, total: int, estado: str = "activo") -> list[Subscription]:
        """Crea un lote de suscripciones con nombres y fechas para probar paginación."""
        suscripciones = []
        for i in range(1, total + 1):
            suscripciones.append(
                Subscription.objects.create(
                    organizacion_id=org_id,
                    nombre=f"Servicio {i:02d}",
                    monto=Decimal(f"{1000 * i}.00"),
                    moneda="CLP",
                    frecuencia="mensual",
                    fecha_proximo_cobro=date(2026, 10, min(i, 28)),
                    categoria="streaming",
                    estado=estado,
                )
            )
        return suscripciones

    def test_pagination_default_page_size_and_structure(
        self, api_client: APIClient, org: uuid.UUID
    ) -> None:
        """GET /api/suscripciones/ con 15 suscripciones devuelve primera página con 10 items y next link."""
        self._crear_lote_suscripciones(org, 15)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK

        data = response.data
        assert set(data.keys()) == {"count", "next", "previous", "results"}
        assert data["count"] == 15
        assert len(data["results"]) == 10
        assert data["next"] is not None
        assert "page=2" in data["next"]
        assert data["previous"] is None

    def test_pagination_page_2_success(
        self, api_client: APIClient, org: uuid.UUID
    ) -> None:
        """GET /api/suscripciones/?page=2 devuelve los 5 items restantes, count, next=None y previous con link."""
        self._crear_lote_suscripciones(org, 15)

        response = api_client.get(
            "/api/suscripciones/?page=2",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK

        data = response.data
        assert data["count"] == 15
        assert len(data["results"]) == 5
        assert data["next"] is None
        assert data["previous"] is not None

    def test_pagination_trello_card_example_suscripciones_page_2(
        self, api_client: APIClient, org: uuid.UUID
    ) -> None:
        """GET /api/suscripciones/?page=2 devuelve la 2da página con count, next y previous."""
        self._crear_lote_suscripciones(org, 15)

        response = api_client.get(
            "/api/suscripciones/?page=2",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK

        data = response.data
        assert "count" in data
        assert "next" in data
        assert "previous" in data
        assert "results" in data

        assert data["count"] == 15
        assert len(data["results"]) == 5
        assert data["next"] is None
        assert data["previous"] is not None

    def test_pagination_custom_page_size_param(
        self, api_client: APIClient, org: uuid.UUID
    ) -> None:
        """Permite parametrizar page_size mediante query param (ej. ?page_size=5)."""
        self._crear_lote_suscripciones(org, 15)

        response = api_client.get(
            "/api/suscripciones/?page_size=5",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 15
        assert len(response.data["results"]) == 5
        assert response.data["next"] is not None

    def test_pagination_invalid_page_returns_404(
        self, api_client: APIClient, org: uuid.UUID
    ) -> None:
        """Una página fuera de rango responde 404 Not Found."""
        self._crear_lote_suscripciones(org, 15)

        response = api_client.get(
            "/api/suscripciones/?page=999",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

        response_str = api_client.get(
            "/api/suscripciones/?page=invalido",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response_str.status_code == status.HTTP_404_NOT_FOUND

    def test_pagination_combined_with_filters(
        self, api_client: APIClient, org: uuid.UUID
    ) -> None:
        """La paginación interactúa correctamente con los filtros (ej. ?estado=activo&page=2)."""
        self._crear_lote_suscripciones(org, 12, estado="activo")
        self._crear_lote_suscripciones(org, 5, estado="cancelado")

        response = api_client.get(
            "/api/suscripciones/?estado=activo&page=2",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 12
        assert len(response.data["results"]) == 2
        for item in response.data["results"]:
            assert item["estado"] == "activo"

    def test_pagination_respects_tenant_isolation(
        self, api_client: APIClient, org: uuid.UUID, org_otra: uuid.UUID
    ) -> None:
        """La paginación cuenta y devuelve solo los registros de la organización autenticada."""
        self._crear_lote_suscripciones(org, 15)
        self._crear_lote_suscripciones(org_otra, 8)

        resp_p1 = api_client.get(
            "/api/suscripciones/?page=1",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert resp_p1.status_code == status.HTTP_200_OK
        assert resp_p1.data["count"] == 15
        assert len(resp_p1.data["results"]) == 10

        resp_p2 = api_client.get(
            "/api/suscripciones/?page=2",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert resp_p2.status_code == status.HTTP_200_OK
        assert resp_p2.data["count"] == 15
        assert len(resp_p2.data["results"]) == 5

        # Todos los items pertenecen a org
        todos_los_ids = [sub["id"] for sub in resp_p1.data["results"] + resp_p2.data["results"]]
        assert len(todos_los_ids) == 15
        for sub_id in todos_los_ids:
            sub = Subscription.objects.get(id=sub_id)
            assert sub.organizacion_id == org

    def test_pagination_single_page_when_fewer_than_page_size(
        self, api_client: APIClient, org: uuid.UUID
    ) -> None:
        """Si hay menos de 10 elementos, devuelve count=5, next=None y previous=None."""
        self._crear_lote_suscripciones(org, 5)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 5
        assert len(response.data["results"]) == 5
        assert response.data["next"] is None
        assert response.data["previous"] is None




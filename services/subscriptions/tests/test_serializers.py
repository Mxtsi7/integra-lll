"""Tests para SubscriptionSerializer – pytest + pytest-django."""

from datetime import date
from decimal import Decimal
import uuid

import pytest

from app.models import Subscription
from app.serializers import SubscriptionSerializer


# ── fixtures ────────────────────────────────────────────────────────


@pytest.fixture()
def valid_payload() -> dict:
    """Payload válido que cumple todas las reglas del serializer."""
    return {
        "nombre": "Netflix",
        "monto": Decimal("12990.00"),
        "moneda": "CLP",
        "frecuencia": "mensual",
        "fecha_proximo_cobro": date(2026, 10, 1).isoformat(),
        "categoria": "streaming",
        "estado": "activo",
    }


# ── tests ───────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSubscriptionSerializerValid:
    """Casos exitosos."""

    def test_subscription_serializer_valid_data(self, valid_payload: dict) -> None:
        """Con datos correctos el serializer es válido."""
        serializer = SubscriptionSerializer(data=valid_payload)
        assert serializer.is_valid(), serializer.errors

    def test_subscription_serializer_normalizes_moneda(
        self, valid_payload: dict
    ) -> None:
        """'clp' en minúscula se normaliza a 'CLP'."""
        valid_payload["moneda"] = "clp"
        serializer = SubscriptionSerializer(data=valid_payload)
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["moneda"] == "CLP"

    def test_subscription_serializer_normalizes_frecuencia_and_estado(
        self, valid_payload: dict
    ) -> None:
        """Mayúsculas en frecuencia y estado se normalizan a minúsculas."""
        valid_payload["frecuencia"] = "MENSUAL"
        valid_payload["estado"] = "ACTIVO"
        serializer = SubscriptionSerializer(data=valid_payload)
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["frecuencia"] == "mensual"
        assert serializer.validated_data["estado"] == "activo"

    @pytest.mark.parametrize(
        "estado",
        ["prueba", "activo", "por_confirmar", "cancelado", "fantasma"],
    )
    def test_subscription_serializer_rf13_estados(
        self, valid_payload: dict, estado: str
    ) -> None:
        """Los 5 estados de RF-13 son aceptados."""
        valid_payload["estado"] = estado
        serializer = SubscriptionSerializer(data=valid_payload)
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["estado"] == estado

    def test_subscription_serializer_save_with_organizacion_id(
        self, valid_payload: dict
    ) -> None:
        """Verifica que el serializer guarda con organizacion_id (ModeloTenant) sin FK a User."""
        serializer = SubscriptionSerializer(data=valid_payload)
        assert serializer.is_valid(), serializer.errors
        org_id = uuid.uuid4()
        instancia = serializer.save(organizacion_id=org_id)
        assert instancia.organizacion_id == org_id
        assert isinstance(instancia.id, uuid.UUID)
        assert instancia.creado_en is not None


@pytest.mark.django_db
class TestSubscriptionSerializerInvalidMonto:
    """Validación del campo monto."""

    def test_subscription_serializer_invalid_monto_negative(
        self, valid_payload: dict
    ) -> None:
        """monto = -500 debe fallar la validación."""
        valid_payload["monto"] = Decimal("-500")
        serializer = SubscriptionSerializer(data=valid_payload)
        assert not serializer.is_valid()
        assert "monto" in serializer.errors

    def test_subscription_serializer_invalid_monto_zero(
        self, valid_payload: dict
    ) -> None:
        """monto = 0 debe fallar la validación."""
        valid_payload["monto"] = Decimal("0")
        serializer = SubscriptionSerializer(data=valid_payload)
        assert not serializer.is_valid()
        assert "monto" in serializer.errors


@pytest.mark.django_db
class TestSubscriptionSerializerMissingFields:
    """Campos obligatorios omitidos."""

    @pytest.mark.parametrize(
        "missing_field",
        ["nombre", "fecha_proximo_cobro", "monto", "frecuencia"],
    )
    def test_subscription_serializer_missing_required_fields(
        self, valid_payload: dict, missing_field: str
    ) -> None:
        """Cada campo obligatorio, al omitirse, produce un error."""
        del valid_payload[missing_field]
        serializer = SubscriptionSerializer(data=valid_payload)
        assert not serializer.is_valid()
        assert missing_field in serializer.errors

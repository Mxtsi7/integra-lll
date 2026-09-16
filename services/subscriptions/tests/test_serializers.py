"""Tests para SubscriptionSerializer – pytest + pytest-django."""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from app.serializers import SubscriptionSerializer

User = get_user_model()


# ── fixtures ────────────────────────────────────────────────────────


@pytest.fixture()
def user(db) -> User:
    """Crea un usuario de prueba en la base de datos."""
    return User.objects.create_user(
        username="testuser",
        password="s3cur3P@ss!",
    )


@pytest.fixture()
def valid_payload(user) -> dict:
    """Payload válido que cumple todas las reglas del serializer."""
    return {
        "nombre": "Netflix",
        "monto": Decimal("12990.00"),
        "moneda": "CLP",
        "ciclo": "MENSUAL",
        "fecha_cobro": date(2026, 10, 1).isoformat(),
        "estado": "ACTIVO",
        "user": user.pk,
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
        ["nombre", "fecha_cobro", "monto", "ciclo", "estado", "user"],
    )
    def test_subscription_serializer_missing_required_fields(
        self, valid_payload: dict, missing_field: str
    ) -> None:
        """Cada campo obligatorio, al omitirse, produce un error."""
        del valid_payload[missing_field]
        serializer = SubscriptionSerializer(data=valid_payload)
        assert not serializer.is_valid()
        assert missing_field in serializer.errors

"""Tests para SubscriptionSerializer – pytest + pytest-django."""

from datetime import date
from decimal import Decimal
import uuid

import pytest

from app.models import Subscription
from app.serializers import RegistrarUsoSerializer, SubscriptionSerializer


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


@pytest.mark.django_db
class TestSubscriptionSerializerReadOnlyFields:
    """Verifica que campos protegidos no sean alterables desde input de cliente."""

    def test_horas_uso_mes_and_ultima_actividad_in_read_only(self) -> None:
        """horas_uso_mes y ultima_actividad deben estar en read_only_fields."""
        read_only = SubscriptionSerializer.Meta.read_only_fields
        assert "horas_uso_mes" in read_only
        assert "ultima_actividad" in read_only

    def test_horas_uso_mes_ignored_on_create(self, valid_payload: dict) -> None:
        """Si el cliente envía horas_uso_mes en creación, se ignora."""
        valid_payload["horas_uso_mes"] = Decimal("100.00")
        serializer = SubscriptionSerializer(data=valid_payload)
        assert serializer.is_valid(), serializer.errors
        instancia = serializer.save(organizacion_id=uuid.uuid4())
        assert instancia.horas_uso_mes is None or instancia.horas_uso_mes != Decimal("100.00")


class TestRegistrarUsoSerializer:
    """Validaciones de minutos en RegistrarUsoSerializer."""

    def test_minutos_validos(self) -> None:
        """Minutos dentro del rango permitido [1, 44640]."""
        s1 = RegistrarUsoSerializer(data={"minutos": 30})
        assert s1.is_valid(), s1.errors
        assert s1.validated_data["minutos"] == 30

        # Tope mensual (24 * 60 * 31 = 44640)
        s2 = RegistrarUsoSerializer(data={"minutos": 44640})
        assert s2.is_valid(), s2.errors
        assert s2.validated_data["minutos"] == 44640

    @pytest.mark.parametrize("minutos_invalidos", [0, -1, -50, 44641, 100000])
    def test_minutos_fuera_de_rango_invalido(self, minutos_invalidos: int) -> None:
        """Valores <= 0 o superiores a 44640 son rechazados."""
        s = RegistrarUsoSerializer(data={"minutos": minutos_invalidos})
        assert not s.is_valid()
        assert "minutos" in s.errors


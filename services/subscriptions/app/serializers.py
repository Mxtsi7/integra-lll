"""Serializers del servicio de suscripciones."""

from decimal import Decimal
from rest_framework import serializers

from app.models import Subscription


class SubscriptionSerializer(serializers.ModelSerializer):
    """Serializa y valida datos de :model:`app.Subscription`."""

    class Meta:
        model = Subscription
        fields = "__all__"
        read_only_fields = ("id", "organizacion_id", "creado_en", "actualizado_en")

    # ── normalización pre-validación ────────────────────────────────

    def to_internal_value(self, data: dict) -> dict:
        """Normaliza campos antes de que los ChoiceField validen.

        - ``moneda`` se convierte a mayúsculas (ej: 'clp' -> 'CLP').
        - ``frecuencia``, ``estado`` y ``categoria`` se convierten a minúsculas.
        """
        if isinstance(data, dict):
            data = data.copy()
            if "moneda" in data and isinstance(data["moneda"], str):
                data["moneda"] = data["moneda"].upper()
            for campo in ("frecuencia", "estado", "categoria"):
                if campo in data and isinstance(data[campo], str):
                    data[campo] = data[campo].lower()
            if data.get("estado") == "cancelada":
                data["estado"] = "cancelado"
        return super().to_internal_value(data)

    # ── validaciones de campo ───────────────────────────────────────

    def validate_monto(self, value: Decimal) -> Decimal:
        """El monto debe ser estrictamente mayor a 0."""
        if value <= 0:
            raise serializers.ValidationError(
                "El monto debe ser mayor a 0."
            )
        return value

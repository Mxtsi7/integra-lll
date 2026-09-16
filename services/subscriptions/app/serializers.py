"""Serializers del servicio de suscripciones."""

from rest_framework import serializers

from app.models import Subscription


class SubscriptionSerializer(serializers.ModelSerializer):
    """Serializa y valida datos de :model:`app.Subscription`."""

    class Meta:
        model = Subscription
        fields = "__all__"
        read_only_fields = ("id",)

    # ── normalización pre-validación ────────────────────────────────

    def to_internal_value(self, data: dict) -> dict:
        """Normaliza campos antes de que los ChoiceField validen.

        ``moneda`` se convierte a mayúsculas para que ``'clp'`` sea
        aceptado como ``'CLP'`` sin romper la validación de choices.
        """
        if isinstance(data, dict) and "moneda" in data and isinstance(data["moneda"], str):
            data = data.copy()
            data["moneda"] = data["moneda"].upper()
        return super().to_internal_value(data)

    # ── validaciones de campo ───────────────────────────────────────

    def validate_monto(self, value) -> "Decimal":  # noqa: F821
        """El monto debe ser estrictamente mayor a 0."""
        if value <= 0:
            raise serializers.ValidationError(
                "El monto debe ser mayor a 0."
            )
        return value

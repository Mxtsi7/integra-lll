"""Serializers del servicio de suscripciones."""

from decimal import Decimal
from rest_framework import serializers

from app.models import Subscription


class SubscriptionSerializer(serializers.ModelSerializer):
    """Serializa y valida datos de :model:`app.Subscription`."""

    class Meta:
        model = Subscription
        fields = "__all__"
        read_only_fields = (
            "id",
            "organizacion_id",
            "creado_en",
            "actualizado_en",
            "horas_uso_mes",
            "ultima_actividad",
        )

    # ── normalización pre-validación ────────────────────────────────

    # Mapeo de nombres legacy (tarjeta Trello) → nombres oficiales (tipos.ts)
    _ALIAS_MAP: dict[str, str] = {
        "ciclo": "frecuencia",
        "fecha_cobro": "fecha_proximo_cobro",
        "activa": "activo",
    }

    def to_internal_value(self, data: dict) -> dict:
        """Normaliza campos antes de que los ChoiceField validen.

        - Alias legacy: ``ciclo`` → ``frecuencia``, ``fecha_cobro`` →
          ``fecha_proximo_cobro``, ``activa`` → ``activo``.
        - ``moneda`` se convierte a mayúsculas (ej: 'clp' -> 'CLP').
        - ``frecuencia``, ``estado`` y ``categoria`` se convierten a minúsculas.
        """
        if isinstance(data, dict):
            data = data.copy()
            # ── alias legacy ────────────────────────────────────────
            for legacy, oficial in self._ALIAS_MAP.items():
                if legacy in data and oficial not in data:
                    data[oficial] = data.pop(legacy)
            # ── normalización de case ───────────────────────────────
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


class RegistrarUsoSerializer(serializers.Serializer):
    """Valida los minutos de uso enviados por el usuario."""

    minutos = serializers.IntegerField(
        min_value=1,
        max_value=24 * 60 * 31,  # 44.640 minutos (tope de un mes de 31 días)
        error_messages={
            "min_value": "Los minutos de uso no pueden ser negativos ni cero.",
            "max_value": "Los minutos de uso no pueden superar el máximo mensual (44.640 minutos).",
            "invalid": "Los minutos deben ser un número entero válido.",
            "required": "El campo minutos es obligatorio.",
        },
    )



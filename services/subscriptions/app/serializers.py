"""Serializers del servicio de suscripciones."""

from decimal import Decimal
from rest_framework import serializers

from app.models import CategoriaSuscripcion, Moneda, RegistroUso, Subscription, TransicionEstado
from django.core.exceptions import ValidationError as ErrorModelo
from shared.catalogos.models import validar_asignacion


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
            "activo",
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

    def validate(self, attrs):
        attrs = super().validate(attrs)
        errores = {}
        for campo, modelo in (("moneda", Moneda), ("categoria", CategoriaSuscripcion)):
            if campo not in attrs and self.instance is not None:
                continue
            codigo = attrs.get(campo, Subscription._meta.get_field(campo).get_default())
            anterior = getattr(self.instance, campo, None)
            try:
                validar_asignacion(modelo, codigo, anterior)
            except ErrorModelo as error:
                errores[campo] = error.messages
        if errores:
            raise serializers.ValidationError(errores)
        if self.instance is None:
            estado = attrs.get("estado", Subscription.Estado.ACTIVO)
            if estado not in (Subscription.Estado.PRUEBA, Subscription.Estado.ACTIVO):
                raise serializers.ValidationError(
                    {
                        "estado": (
                            "Una suscripción nueva solo puede iniciar en prueba "
                            "o activo."
                        )
                    }
                )
            if (
                estado == Subscription.Estado.PRUEBA
                and attrs.get("fin_prueba") is None
            ):
                raise serializers.ValidationError(
                    {"fin_prueba": "Es obligatorio para una suscripción en prueba."}
                )
        return attrs

    def create(self, validated_data):
        try:
            return super().create(validated_data)
        except ErrorModelo as error:
            raise serializers.ValidationError(error.message_dict) from error

    def update(self, instance, validated_data):
        try:
            return super().update(instance, validated_data)
        except ErrorModelo as error:
            raise serializers.ValidationError(error.message_dict) from error

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
    fecha = serializers.DateField(required=False, default=None)

    def validate_fecha(self, value):
        """Rechaza fechas posteriores a hoy (hora local del servidor)."""
        from django.utils import timezone

        if value is not None and value > timezone.localdate():
            raise serializers.ValidationError(
                "No se puede registrar uso de una fecha futura."
            )
        return value


class RegistroUsoSerializer(serializers.ModelSerializer):
    """Serializa los registros históricos de uso de una suscripción (CU-23 / RF-04 / RF-15)."""

    class Meta:
        model = RegistroUso
        fields = ("fecha", "minutos")


class CalendarioCobroSerializer(serializers.Serializer):
    """Contrato del calendario mensual de cobros confirmados y proyectados."""

    id = serializers.UUIDField()
    suscripcion_id = serializers.UUIDField()
    fecha = serializers.DateField()
    servicio = serializers.CharField()
    importe = serializers.DecimalField(max_digits=10, decimal_places=2)
    moneda = serializers.CharField(max_length=3)
    tipo = serializers.ChoiceField(choices=("confirmado", "proyectado"))


class SolicitarTransicionSerializer(serializers.Serializer):
    """Eventos de estado que puede solicitar un usuario de la organización."""

    evento = serializers.ChoiceField(
        choices=(
            (
                Subscription.EventoEstado.CANCELACION_USUARIO,
                Subscription.EventoEstado.CANCELACION_USUARIO.label,
            ),
            (
                Subscription.EventoEstado.CONFIRMACION_USUARIO,
                Subscription.EventoEstado.CONFIRMACION_USUARIO.label,
            ),
        )
    )


class TransicionEstadoSerializer(serializers.ModelSerializer):
    """Serializa el historial de auditoría de estados."""

    class Meta:
        model = TransicionEstado
        fields = (
            "id",
            "evento",
            "estado_anterior",
            "estado_nuevo",
            "actor_id",
            "actor_rol",
            "ocurrido_en",
        )
        read_only_fields = fields

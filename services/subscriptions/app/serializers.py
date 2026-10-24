"""Serializers del servicio de suscripciones."""

from decimal import Decimal
import re

from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from app.models import (
    CategoriaSuscripcion,
    Moneda,
    Cobro,
    Presupuesto,
    RegistroUso,
    Subscription,
    TransicionEstado,
)
from django.core.exceptions import ValidationError as ErrorModelo
from shared.catalogos.models import validar_asignacion


class CobroSerializer(serializers.ModelSerializer):
    """Serializa el histórico de cobros reales de una suscripción (VI-04 / RF-05).

    NOTA: hubo_alza se excluye intencionalmente. La property de Cobro compara
    contra suscripcion.monto ACTUAL: si el usuario edita el monto, cambia la
    marca de todos los cobros pasados (reescribe históricos). Además VI-19
    define el alza como >5 % sobre el promedio de 3 meses; exponer ahora otra
    definición deja dos verdades. Se incluirá en VI-19.
    """

    class Meta:
        model = Cobro
        fields = (
            "id",
            "suscripcion_id",
            "monto",
            "moneda",
            "fecha",
            "creado_en",
        )
        read_only_fields = fields


class SubscriptionSerializer(serializers.ModelSerializer):
    """Serializa y valida datos de :model:`app.Subscription`.

    ``horas_uso_mes`` se calcula al leer desde el histórico de registros de
    uso del mes local actual (Sum filtrada). Así, al cambiar de mes el valor
    baja a 0 automáticamente sin necesitar una tarea de beat (VI-10).
    """

    horas_uso_mes = serializers.SerializerMethodField()

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

    def get_horas_uso_mes(self, obj: Subscription) -> str:
        """Recalcula las horas de uso del mes local actual desde el histórico."""
        hoy = timezone.localdate()
        primer_dia = hoy.replace(day=1)
        if hoy.month == 12:
            primer_dia_siguiente = primer_dia.replace(
                year=hoy.year + 1, month=1
            )
        else:
            primer_dia_siguiente = primer_dia.replace(month=hoy.month + 1)

        total_minutos = (
            RegistroUso.objects.filter(
                suscripcion=obj,
                fecha__gte=primer_dia,
                fecha__lt=primer_dia_siguiente,
            ).aggregate(total=Sum("minutos"))["total"]
            or 0
        )
        return str(
            (Decimal(total_minutos) / Decimal("60")).quantize(Decimal("0.01"))
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


class PresupuestoSerializer(serializers.ModelSerializer):
    """Serializa y valida el presupuesto mensual de una organización (VI-05 / RF-13 / RF-19)."""

    class Meta:
        model = Presupuesto
        fields = ("id", "mes", "moneda", "monto", "creado_en", "actualizado_en")
        read_only_fields = ("id", "creado_en", "actualizado_en")

    def validate_mes(self, value: str) -> str:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
            raise serializers.ValidationError("Debe tener el formato YYYY-MM.")
        return value

    def validate_monto(self, value: Decimal) -> Decimal:
        if value <= 0:
            raise serializers.ValidationError("El monto presupuestado debe ser mayor a 0.")
        return value


class PresupuestoComparacionSerializer(serializers.Serializer):
    """Contrato de comparación entre presupuesto mensual y proyección/gasto (VI-05)."""

    mes = serializers.CharField()
    moneda = serializers.CharField()
    presupuesto = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    gasto_real = serializers.DecimalField(max_digits=10, decimal_places=2)
    gasto_proyectado = serializers.DecimalField(max_digits=10, decimal_places=2)
    total_esperado = serializers.DecimalField(max_digits=10, decimal_places=2)
    diferencia = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    porcentaje_consumido = serializers.FloatField()
    alerta_superado = serializers.BooleanField()


class ConteoEstadosSerializer(serializers.Serializer):
    """Conteo de suscripciones por estado."""

    activo = serializers.IntegerField(default=0)
    prueba = serializers.IntegerField(default=0)
    por_confirmar = serializers.IntegerField(default=0)
    cancelado = serializers.IntegerField(default=0)
    fantasma = serializers.IntegerField(default=0)
    total = serializers.IntegerField(default=0)


class ResumenPanelSerializer(serializers.Serializer):
    """Contrato del resumen agregado del panel para el periodo (VI-06 / RF-11 / RF-09)."""

    periodo = serializers.CharField()
    moneda = serializers.CharField()
    gasto_real = serializers.DecimalField(max_digits=10, decimal_places=2)
    gasto_proyectado = serializers.DecimalField(max_digits=10, decimal_places=2)
    total_estimado = serializers.DecimalField(max_digits=10, decimal_places=2)
    conteo_estados = ConteoEstadosSerializer()


from rest_framework import serializers

from analytics.models import (
    DIAS_VIGENCIA_DESCARTE_DEFAULT,
    DIAS_VIGENCIA_DESCARTE_MAX,
    RecomendacionConsolidacion,
    RecomendacionDescartada,
)


class RecomendacionConsolidacionSerializer(serializers.ModelSerializer):
    """Contrato compatible con ``frontend/shared/src/api/recomendaciones.ts``."""

    nombre = serializers.CharField(source="suscripcion_nombre", read_only=True)
    ahorro_estimado = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        coerce_to_string=False,
        read_only=True,
    )
    evidencia = serializers.SerializerMethodField()

    class Meta:
        model = RecomendacionConsolidacion
        fields = [
            "id",
            "suscripcion_id",
            "nombre",
            "categoria",
            "motivo",
            "ahorro_estimado",
            "moneda",
            "estado",
            "evidencia",
            "ocurrido_en",
        ]

    def get_evidencia(self, recomendacion):
        return {
            "id": recomendacion.evidencia_id,
            "url": recomendacion.evidencia_url,
            "descripcion": recomendacion.evidencia_descripcion,
        }


class ListaRecomendacionesSerializer(serializers.Serializer):
    """Envoltura estable: el cliente acepta ``results`` y siempre hay motivo."""

    results = RecomendacionConsolidacionSerializer(many=True, read_only=True)
    total = serializers.IntegerField(read_only=True)
    moneda = serializers.CharField(read_only=True, allow_null=True)
    umbral_aplicado = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        coerce_to_string=False,
        read_only=True,
        allow_null=True,
    )
    disponible = serializers.BooleanField(read_only=True)
    motivo_sin_sugerencias = serializers.CharField(
        read_only=True,
        allow_null=True,
        allow_blank=True,
    )
    umbrales_no_configurados = serializers.ListField(
        child=serializers.CharField(),
        read_only=True,
    )


class SolicitarDescarteSerializer(serializers.Serializer):
    """Parámetros opcionales para descartar una recomendación (VI-18)."""

    motivo = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        default="",
        help_text="Motivo opcional del descarte",
    )
    dias_vigencia = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=DIAS_VIGENCIA_DESCARTE_MAX,
        default=DIAS_VIGENCIA_DESCARTE_DEFAULT,
        help_text=(
            "Días de vigencia del descarte antes de volver a mostrarla "
            f"(máx. {DIAS_VIGENCIA_DESCARTE_MAX})"
        ),
    )


class RecomendacionDescartadaSerializer(serializers.ModelSerializer):
    """Confirmación del descarte de una recomendación (VI-18)."""

    recomendacion_id = serializers.UUIDField(read_only=True)
    suscripcion_id = serializers.UUIDField(
        source="recomendacion.suscripcion_id",
        read_only=True,
    )
    descartado = serializers.SerializerMethodField()

    class Meta:
        model = RecomendacionDescartada
        fields = (
            "id",
            "recomendacion_id",
            "suscripcion_id",
            "motivo",
            "descartado_por",
            "vigente_hasta",
            "creado_en",
            "descartado",
        )
        read_only_fields = fields

    def get_descartado(self, obj) -> bool:
        return True

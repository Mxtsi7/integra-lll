from rest_framework import serializers

from analytics.models import RecomendacionConsolidacion


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

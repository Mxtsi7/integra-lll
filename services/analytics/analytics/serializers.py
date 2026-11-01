from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from analytics.models import (
    DIAS_VIGENCIA_DESCARTE_DEFAULT,
    DIAS_VIGENCIA_DESCARTE_MAX,
    RecomendacionConsolidacion,
    RecomendacionDescartada,
    UsoMensual,
)


# ── Uso por periodo (FE-28) y puntaje (FE-29) ────────────────────────

class UsoMensualSerializer(serializers.ModelSerializer):
    """El agregado proyectado. Solo salida: esto no se escribe por API."""

    class Meta:
        model = UsoMensual
        fields = (
            "id",
            "suscripcion_id",
            "mes",
            "minutos",
            "dias_con_uso",
            "ultimo_uso",
            "actualizado_en",
        )
        read_only_fields = fields


class PuntajeUsoSerializer(serializers.Serializer):
    """El puntaje de FE-29, tal como lo consume Recommendations (VI-17).

    `clasificacion` es lo que manda, no `puntaje`: con `sin_datos` el puntaje
    viene en 0 y NO significa bajo uso. Ver la vista.
    """

    suscripcion_id = serializers.CharField(read_only=True)
    mes_final = serializers.CharField(read_only=True)
    meses_evaluados = serializers.IntegerField(read_only=True)
    minutos_totales = serializers.IntegerField(read_only=True)
    minutos_por_mes = serializers.FloatField(read_only=True)
    dias_con_uso = serializers.IntegerField(read_only=True)
    puntaje = serializers.IntegerField(
        read_only=True,
        help_text="0 a 100, normalizado contra el umbral. 100 = llega al umbral.",
    )
    clasificacion = serializers.CharField(
        read_only=True,
        help_text="sin_datos | bajo | normal | alto. Mirar esto, no el puntaje.",
    )
    evidencia = serializers.JSONField(
        read_only=True,
        help_text="Por qué dio eso: umbral usado, días observados, desglose por mes y motivo.",
    )


class EvidenciaRecomendacionSerializer(serializers.Serializer):
    id = serializers.CharField()
    url = serializers.URLField()
    descripcion = serializers.CharField()


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

    @extend_schema_field(EvidenciaRecomendacionSerializer)
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


class ConsultaAsistenteSerializer(serializers.Serializer):
    """Mensaje opcional del usuario para el asistente (VI-22)."""

    mensaje = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        default="",
        help_text="Pregunta libre sobre los datos de la organización",
    )

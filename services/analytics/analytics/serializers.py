from rest_framework import serializers

# Analytics serializers will be defined here.


# ── Uso por periodo (FE-28) y puntaje (FE-29) ────────────────────────

from analytics.models import UsoMensual  # noqa: E402


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

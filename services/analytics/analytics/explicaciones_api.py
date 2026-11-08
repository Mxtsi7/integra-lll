from uuid import UUID

from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .explicaciones import explicar
from .models import ESTADO_RECOMENDACION_VIGENTE, RecomendacionConsolidacion, RecomendacionDescartada
from .reglas import umbral_minimo
from .serializers import EvidenciaRecomendacionSerializer
from .views import _contexto_organizacion


class ExplicacionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    suscripcion_id = serializers.UUIDField()
    explicacion = serializers.CharField()
    fuente = serializers.ChoiceField(choices=["reglas"])
    estado = serializers.ChoiceField(choices=["disponible", "datos_insuficientes"])
    motivo = serializers.CharField(allow_null=True)
    ahorro_estimado = serializers.DecimalField(max_digits=14, decimal_places=2, coerce_to_string=False, allow_null=True)
    moneda = serializers.CharField()
    base_calculo = serializers.CharField(allow_null=True)
    evidencia = EvidenciaRecomendacionSerializer(allow_null=True)
    uso = serializers.ChoiceField(choices=["no_evaluado"])
    advertencia_uso = serializers.CharField()


@extend_schema(
    summary="Explicar una recomendación con sus hechos persistidos (MX-25)",
    description=("Disponible sin IA y sin consumo de cuota. Aplica el tenant, umbral y descarte "
                 "del listado VI-17/VI-18. El Gateway exige JWT y la feature de recomendaciones. "
                 "Los servicios internos solo aceptan contexto del Gateway en una red privada."),
    responses={200: ExplicacionSerializer, 403: OpenApiResponse(description="Falta contexto de organización válido."),
               404: OpenApiResponse(description="Recomendación inexistente, ajena, descartada o no visible por umbral.")},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def recomendaciones_explicar(request, pk):
    org = _contexto_organizacion(request)
    no_encontrada = Response({"detail": "Recomendación no encontrada."}, status=404)
    try:
        identificador = UUID(str(pk))
    except (ValueError, TypeError, AttributeError):
        return no_encontrada
    descartes = RecomendacionDescartada.objects.filter(organizacion_id=org).filter(
        Q(vigente_hasta__isnull=True) | Q(vigente_hasta__gt=timezone.now())
    ).values("recomendacion_id")
    fila = RecomendacionConsolidacion.objects.filter(
        pk=identificador, organizacion_id=org, estado=ESTADO_RECOMENDACION_VIGENTE,
    ).exclude(pk__in=descartes).first()
    if fila is None:
        return no_encontrada
    umbral = umbral_minimo(fila.moneda)
    if umbral is None or fila.ahorro_estimado < umbral:
        return no_encontrada
    return Response(ExplicacionSerializer(explicar(fila)).data)

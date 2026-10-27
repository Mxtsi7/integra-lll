import datetime as dt
import re
import uuid

from drf_spectacular.utils import OpenApiParameter
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.views import APIView

from shared.tenant.base import SoloLecturaTenantViewSet

from analytics.models import UsoMensual
from analytics.serializers import PuntajeUsoSerializer, UsoMensualSerializer
from analytics.uso import puntuar_organizacion
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@extend_schema(responses={200: inline_serializer(name="SaludAnalytics", fields={"status": serializers.CharField(), "service": serializers.CharField()})})
@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    return Response({
        'status': 'ok',
        'service': 'analytics'
    }, status=status.HTTP_200_OK)


# ═══════════════════════════════════════════════════════════════════
# Uso por periodo (FE-28) y puntaje de bajo uso (FE-29)
# ═══════════════════════════════════════════════════════════════════


def _mes_pedido(request):
    """Lee ?mes=YYYY-MM. Es obligatorio a propósito.

    Podría inferirse del mes actual, y no se hace: un puntaje sin saber de qué
    mes es no se puede comparar ni reproducir, y FE-29 pide justamente que el
    mismo conjunto dé siempre lo mismo. Que el cliente diga el mes lo obliga a
    guardarlo junto al resultado.
    """
    crudo = request.query_params.get("mes")
    if not crudo:
        raise ValidationError({"mes": "Falta el mes, en formato YYYY-MM."})
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", crudo):
        raise ValidationError({"mes": "Debe tener el formato YYYY-MM."})
    return dt.date.fromisoformat(f"{crudo}-01")


class UsoMensualViewSet(SoloLecturaTenantViewSet):
    """
        GET /api/analitica/uso-mensual/            lista
        GET /api/analitica/uso-mensual/?mes=2026-10

    El agregado mensual proyectado (FE-28). Solo lectura: estas tablas las
    escribe únicamente el consumidor de eventos. Si hubiera un POST acá, el
    agregado podría dejar de coincidir con los registros fuente y el criterio
    de FE-28 dejaría de poder comprobarse.
    """

    queryset = UsoMensual.objects.all()
    serializer_class = UsoMensualSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action != "list":
            return qs
        crudo = self.request.query_params.get("mes")
        if crudo:
            qs = qs.filter(mes=_mes_pedido(self.request))
        suscripcion = self.request.query_params.get("suscripcion_id")
        if suscripcion:
            try:
                qs = qs.filter(suscripcion_id=uuid.UUID(suscripcion))
            except (ValueError, AttributeError):
                raise ValidationError({"suscripcion_id": "No es un UUID."})
        return qs


@extend_schema(
    parameters=[
        OpenApiParameter(
            "mes",
            str,
            description="Mes final de la ventana, YYYY-MM. Obligatorio.",
            required=True,
        )
    ],
    responses={200: PuntajeUsoSerializer(many=True)},
    summary="Puntaje de uso y señal de bajo uso por suscripción (FE-29)",
)
class PuntajesUsoView(APIView):
    """
        GET /api/analitica/puntajes-uso/?mes=2026-10

    Lo que consume Recommendations (VI-17). Para cada suscripción observada
    de la organización devuelve el puntaje, la clasificación y la evidencia.

    ── Hay que mirar `clasificacion`, no `puntaje` ─────────────────────────
    Cuando no hay datos suficientes la clasificación es `sin_datos` y el
    puntaje viene en 0. Un consumidor que mire solo el número concluiría bajo
    uso donde lo honesto es no concluir nada. La evidencia trae `motivo` con
    la explicación en texto, y `uso_cero_real` distingue el cero de verdad
    (observada hace rato, sin un minuto) del cero por falta de datos.

    No escribe nada: es una función pura del agregado. Se puede pedir el mismo
    mes las veces que haga falta.
    """

    def get(self, request):
        org = getattr(request, "organizacion_id", None)
        if not org:
            raise PermissionDenied("Falta el contexto de organización")
        mes = _mes_pedido(request)
        hoy = timezone.localdate()
        if mes > hoy.replace(day=1):
            # Un mes que todavía no empezó no tiene nada que puntuar, y
            # responder ceros se leería como "no se usa".
            raise ValidationError({"mes": "Ese mes todavía no empieza."})

        # ── El corte lo pone la vista, no la fórmula ─────────────────────────
        # `puntuar` es determinístico porque no mira el reloj: la fecha de
        # corte es un parámetro. La vista es la que sabe qué día es hoy.
        #
        # Sin esto, un GET del mes EN CURSO contaba como observados los días
        # que todavía no ocurrieron: con la suscripción creada el 1 de octubre
        # y el GET hecho el 2, respondía `dias_observados=30` y `bajo`. Lo
        # reprodujo la revisión de la PR.
        #
        # `puntuar` lo recorta al último día del mes pedido, así que para un
        # mes ya cerrado pasar hoy no cambia nada.
        puntajes = puntuar_organizacion(
            organizacion_id=org, mes_final=mes, hasta=hoy
        )
        return Response(
            PuntajeUsoSerializer([p.como_dict() for p in puntajes], many=True).data,
            status=status.HTTP_200_OK,
        )

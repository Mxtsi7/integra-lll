import datetime as dt
import re
import uuid
from datetime import timedelta
from uuid import UUID

from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.tenant.base import SoloLecturaTenantViewSet

from analytics.models import (
    ESTADO_RECOMENDACION_VIGENTE,
    RecomendacionConsolidacion,
    RecomendacionDescartada,
    UsoMensual,
)
from analytics.reglas import normalizar_moneda, umbrales_activos
from analytics.serializers import (
    ListaRecomendacionesSerializer,
    PuntajeUsoSerializer,
    RecomendacionDescartadaSerializer,
    SolicitarDescarteSerializer,
    UsoMensualSerializer,
)
from analytics.uso import puntuar_organizacion


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


def _contexto_organizacion(request):
    organizacion_id = getattr(request, "organizacion_id", None)
    if not organizacion_id:
        raise PermissionDenied("Falta el contexto de organización")
    try:
        return UUID(str(organizacion_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise PermissionDenied("El contexto de organización no es válido") from exc


def _motivo_sin_sugerencias(*, filas, sin_umbral, hay_configuracion):
    if not hay_configuracion:
        if sin_umbral:
            monedas = ", ".join(sin_umbral)
            return (
                f"No hay umbral de ahorro configurado para {monedas}. "
                "Sin configuración válida no se emiten recomendaciones."
            )
        return (
            "No hay umbral de ahorro configurado para ninguna moneda. "
            "Sin configuración válida no se emiten recomendaciones."
        )
    if not filas:
        return "Todavía no hay recomendaciones de consolidación generadas."
    return "Ninguna recomendación alcanza el umbral de ahorro configurado."


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


@extend_schema(
    parameters=[
        OpenApiParameter(
            name="moneda",
            description="Filtra por código ISO 4217 (por ejemplo CLP).",
            required=False,
            type=str,
        )
    ],
    responses={200: ListaRecomendacionesSerializer},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def recomendaciones_list(request):
    """Lista lo persistido desde VI-20 aplicando RN-REC-001 por moneda."""
    organizacion_id = _contexto_organizacion(request)

    moneda_solicitada = request.query_params.get("moneda")
    if moneda_solicitada is not None:
        try:
            moneda_solicitada = normalizar_moneda(moneda_solicitada)
        except ValueError as exc:
            raise ValidationError({"moneda": [str(exc)]}) from exc

    consulta = RecomendacionConsolidacion.objects.filter(
        organizacion_id=organizacion_id,
        estado=ESTADO_RECOMENDACION_VIGENTE,
    ).order_by("-ocurrido_en")
    if moneda_solicitada:
        consulta = consulta.filter(moneda=moneda_solicitada)

    # VI-18: un descarte vigente oculta la recomendación; al expirar vuelve a
    # mostrarse. Un descarte sin fecha se considera vigente indefinidamente.
    descartes_vigentes = RecomendacionDescartada.objects.filter(
        organizacion_id=organizacion_id,
    ).filter(
        Q(vigente_hasta__isnull=True) | Q(vigente_hasta__gt=timezone.now())
    ).values("recomendacion_id")
    consulta = consulta.exclude(id__in=descartes_vigentes)

    filas = list(consulta)

    monedas_con_datos = {fila.moneda for fila in filas}
    monedas_consideradas = (
        {moneda_solicitada} if moneda_solicitada else monedas_con_datos
    )
    umbrales = umbrales_activos(monedas_consideradas)
    sin_umbral = sorted(
        moneda for moneda in monedas_consideradas if moneda not in umbrales
    )

    resultados = [
        fila
        for fila in filas
        if fila.moneda in umbrales
        and fila.ahorro_estimado >= umbrales[fila.moneda]
    ]

    if monedas_consideradas:
        hay_configuracion = bool(umbrales)
    else:
        # Sin recomendaciones todavía: el listado sirve solo si al menos una
        # moneda tiene configuración válida.
        hay_configuracion = bool(umbrales_activos())

    if moneda_solicitada:
        disponible = moneda_solicitada in umbrales
    else:
        disponible = hay_configuracion

    datos = {
        "results": resultados,
        "total": len(resultados),
        "moneda": moneda_solicitada,
        "umbral_aplicado": umbrales.get(moneda_solicitada),
        "disponible": disponible,
        "motivo_sin_sugerencias": (
            None
            if resultados
            else _motivo_sin_sugerencias(
                filas=filas,
                sin_umbral=sin_umbral,
                hay_configuracion=hay_configuracion,
            )
        ),
        "umbrales_no_configurados": sin_umbral,
    }
    return Response(ListaRecomendacionesSerializer(datos).data)


@extend_schema(
    request=SolicitarDescarteSerializer,
    responses={200: RecomendacionDescartadaSerializer},
    description=(
        "Descarta una recomendación con vigencia temporal e idempotencia (VI-18)."
    ),
)
@api_view(["POST"])
@permission_classes([AllowAny])
def recomendaciones_dismiss(request, pk):
    """POST /api/recomendaciones/{id}/dismiss/ (VI-18).

    El identificador debe ser un UUID y pertenecer a la organización de la
    petición; en cualquier otro caso responde 404. Un ``pk`` no UUID nunca
    produce 500.
    """
    organizacion_id = _contexto_organizacion(request)

    try:
        recomendacion_id = UUID(str(pk))
    except (TypeError, ValueError, AttributeError):
        return Response(
            {"detail": "Recomendación no encontrada para la organización autenticada."},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        recomendacion = RecomendacionConsolidacion.objects.get(
            pk=recomendacion_id,
            organizacion_id=organizacion_id,
        )
    except RecomendacionConsolidacion.DoesNotExist:
        return Response(
            {"detail": "Recomendación no encontrada para la organización autenticada."},
            status=status.HTTP_404_NOT_FOUND,
        )

    entrada = SolicitarDescarteSerializer(data=request.data or {})
    entrada.is_valid(raise_exception=True)
    dias_vigencia = entrada.validated_data["dias_vigencia"]
    motivo = entrada.validated_data["motivo"]

    actor_id = getattr(request, "usuario_id", None)
    descartado_por = None
    if actor_id not in (None, ""):
        try:
            descartado_por = int(actor_id)
        except (TypeError, ValueError):
            descartado_por = None

    vigente_hasta = timezone.now() + timedelta(days=dias_vigencia)

    # Idempotente: repetir el descarte actualiza la misma fila y no duplica el
    # registro. Si ya expiró, la nueva petición renueva la vigencia.
    descarte, _ = RecomendacionDescartada.objects.update_or_create(
        organizacion_id=organizacion_id,
        recomendacion=recomendacion,
        defaults={
            "motivo": motivo,
            "descartado_por": descartado_por,
            "vigente_hasta": vigente_hasta,
        },
    )

    return Response(
        RecomendacionDescartadaSerializer(descarte).data,
        status=status.HTTP_200_OK,
    )

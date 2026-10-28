from uuid import UUID

from rest_framework import serializers, status
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from analytics.models import (
    ESTADO_RECOMENDACION_VIGENTE,
    RecomendacionConsolidacion,
)
from analytics.reglas import normalizar_moneda, umbrales_activos
from analytics.serializers import ListaRecomendacionesSerializer


@extend_schema(responses={200: inline_serializer(name="SaludAnalytics", fields={"status": serializers.CharField(), "service": serializers.CharField()})})
@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    return Response({
        'status': 'ok',
        'service': 'analytics'
    }, status=status.HTTP_200_OK)


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

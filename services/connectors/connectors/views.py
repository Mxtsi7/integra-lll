"""Vistas del servicio de conectores."""

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination

from shared.tenant.base import SoloLecturaTenantViewSet

from .models import CuentaConectada
from .serializers import CuentaConectadaSerializer


def salud(request):
    """
    Lo consulta el HEALTHCHECK del Dockerfile. Toca la base a propósito:
    un servicio que no llega a su esquema no está sano, aunque responda.
    """
    with connection.cursor() as cursor:
        if connection.vendor == "sqlite":
            esquema = settings.ESQUEMA_BD
        else:
            cursor.execute("SELECT current_schema()")
            esquema = cursor.fetchone()[0]
    return JsonResponse(
        {"servicio": settings.SERVICE_NAME, "esquema": esquema, "estado": "ok"}
    )


class CuentaConectadaPagination(PageNumberPagination):
    """La misma paginación que subscriptions, para no sorprender al frontend."""

    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


class CuentaConectadaViewSet(SoloLecturaTenantViewSet):
    """
    Cuentas de correo conectadas por la organización (FE-02 / RF-26).

        GET /api/conectores/              lista
        GET /api/conectores/<id>/         detalle

    Solo lectura a propósito. Una cuenta conectada no se crea con un POST
    suelto: nace del callback de OAuth (FE-04), que llega con un código del
    proveedor y hay que canjearlo. Dejar aquí un `create` abierto permitiría
    inventar una cuenta con tokens arbitrarios.

    Filtros opcionales del listado:
        ?estado=conectada
        ?proveedor=gmail
        ?necesita_reautorizacion=true

    El aislamiento por organización lo pone `SoloLecturaTenantViewSet`: filtra
    por la cabecera `X-Organizacion-Id` que inyecta el gateway, y responde 403
    si no viene.
    """

    queryset = CuentaConectada.objects.all()
    serializer_class = CuentaConectadaSerializer
    pagination_class = CuentaConectadaPagination

    def get_queryset(self):
        qs = super().get_queryset()

        # Solo el listado se filtra. get_queryset() también lo usa `retrieve`,
        # y ahí un query param colgado haría desaparecer el recurso con un 404.
        if self.action != "list":
            return qs

        estado = self.request.query_params.get("estado")
        if estado:
            validos = CuentaConectada.Estado.values
            if estado not in validos:
                raise ValidationError(
                    {"estado": f"Debe ser uno de: {', '.join(validos)}."}
                )
            qs = qs.filter(estado=estado)

        proveedor = self.request.query_params.get("proveedor")
        if proveedor:
            validos = CuentaConectada.Proveedor.values
            if proveedor not in validos:
                raise ValidationError(
                    {"proveedor": f"Debe ser uno de: {', '.join(validos)}."}
                )
            qs = qs.filter(proveedor=proveedor)

        reautorizar = self.request.query_params.get("necesita_reautorizacion")
        if reautorizar is not None:
            # `necesita_reautorizacion` es una propiedad de Python, no una
            # columna, así que no se puede filtrar por ella. Se traduce al
            # estado que la define, para que el filtro siga ocurriendo en la
            # base y no trayendo todas las filas a memoria.
            if reautorizar.lower() in ("true", "1"):
                qs = qs.filter(estado=CuentaConectada.Estado.REQUIERE_REAUTORIZACION)
            elif reautorizar.lower() in ("false", "0"):
                qs = qs.exclude(estado=CuentaConectada.Estado.REQUIERE_REAUTORIZACION)
            else:
                raise ValidationError(
                    {"necesita_reautorizacion": "Debe ser true o false."}
                )

        return qs

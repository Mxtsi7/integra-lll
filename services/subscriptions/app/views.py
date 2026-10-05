"""Vistas del servicio de suscripciones."""

from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from app.models import Subscription
from app.serializers import RegistrarUsoSerializer, SubscriptionSerializer
from shared.tenant.base import TenantViewSet


class SubscriptionPagination(PageNumberPagination):
    """
    Paginación estándar para suscripciones (DRF PageNumberPagination).

    - page_size por defecto: 10
    - page_size_query_param: 'page_size' para permitir parametrización opcional
    - max_page_size: 100
    - Respuesta estructurada con 'count', 'next', 'previous' y 'results'.
    """

    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


class SubscriptionViewSet(TenantViewSet):
    """
    CRUD completo de suscripciones con aislamiento multi-tenant estricto.

    - Filtra automáticamente por la organización del request (X-Organizacion-Id).
    - Asigna organizacion_id en la creación.
    - Soporta GET (list, retrieve), POST (create), PUT (update),
      PATCH (partial_update) y DELETE (destroy).
    - Devuelve 403 si falta la cabecera X-Organizacion-Id.
    - Devuelve 404 si el recurso solicitado no pertenece a la organización autenticada.
    - Paginación en GET con PageNumberPagination (page_size=10, ?page=X).
    - Acepta query params opcionales para filtrar el listado:
        ?estado=activo
        ?fecha_cobro=2026-10-01   (alias de fecha_proximo_cobro)
        ?estado=activo&fecha_cobro=2026-10-01
    - Expone POST /subscriptions/<id>/uso/ para registrar minutos de uso.
    """

    queryset = Subscription.objects.all()
    serializer_class = SubscriptionSerializer
    pagination_class = SubscriptionPagination

    def get_queryset(self):
        """Filtra por tenant y aplica query params opcionales de estado y fecha de cobro."""
        qs = super().get_queryset()

        # Solo el listado se filtra: get_queryset() también lo usan retrieve,
        # update y destroy, y ahí un query param colgado haría desaparecer el
        # recurso con un 404.
        if self.action != "list":
            return qs

        estado = self.request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)

        # Acepta tanto 'fecha_cobro' (alias de la tarjeta) como 'fecha_proximo_cobro'
        fecha_cobro = self.request.query_params.get(
            "fecha_cobro"
        ) or self.request.query_params.get("fecha_proximo_cobro")
        if fecha_cobro:
            try:
                fecha = parse_date(fecha_cobro)
            except ValueError:
                # bien formada pero imposible: 2026-13-45
                fecha = None

            if fecha is None:
                raise ValidationError({"fecha_cobro": "Debe tener el formato YYYY-MM-DD."})

            qs = qs.filter(fecha_proximo_cobro=fecha)

        return qs

    @action(detail=True, methods=["post"], url_path="uso")
    def uso(self, request, pk=None):
        """
        Registra minutos de uso para una suscripción (CU-23 / RF-15 / RF-16).

        - Actualiza el campo 'ultima_actividad' con la fecha/hora actual.
        - Suma los minutos convertidos a horas en 'horas_uso_mes'.
        - Si la suscripción estaba en estado 'fantasma', la devuelve a 'activo' (CU-27 / RF-13).
        - No permite valores negativos ni cero en minutos (responde 400).
        """
        subscription = self.get_object()
        serializer = RegistrarUsoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        minutos = serializer.validated_data["minutos"]
        subscription.registrar_uso(minutos)

        return Response(
            SubscriptionSerializer(subscription).data,
            status=status.HTTP_200_OK,
        )


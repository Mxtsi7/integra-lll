"""Vistas del servicio de suscripciones."""

from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from app.models import Subscription
from app.serializers import RegistrarUsoSerializer, RegistroUsoSerializer, SubscriptionSerializer
from events.despacho import al_crear_suscripcion
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
      PATCH (partial_update) y DELETE (destroy, desactivación lógica).
    - Devuelve 403 si falta la cabecera X-Organizacion-Id.
    - Devuelve 404 si el recurso solicitado no pertenece a la organización autenticada.
    - Paginación en GET con PageNumberPagination (page_size=10, ?page=X).
    - Acepta query params opcionales para filtrar el listado:
        ?estado=activo
        ?fecha_cobro=2026-10-01   (alias de fecha_proximo_cobro)
        ?estado=activo&fecha_cobro=2026-10-01
    - Expone GET y POST /api/suscripciones/<id>/uso/ para consultar el histórico y registrar minutos de uso.
    """

    queryset = Subscription.objects.all()
    serializer_class = SubscriptionSerializer
    pagination_class = SubscriptionPagination

    def get_queryset(self):
        """Filtra por tenant, suscripciones activas y parámetros de listado."""
        qs = super().get_queryset().filter(activo=True)

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

    def perform_create(self, serializer):
        """Crea la suscripción y despacha el trabajo derivado (ADR-003).

        El `super()` guarda asignando la organización de la cabecera. Recién
        después se despacha, porque el evento lleva el id de la suscripción y
        antes de guardar no existe.

        Según `EVENTOS_ASINCRONOS`, `al_crear_suscripcion` recalcula el
        resumen acá mismo (y el usuario espera) o publica el evento y vuelve
        al tiro. La vista no sabe cuál de los dos: esa decisión vive en
        events/despacho.py.
        """
        super().perform_create(serializer)
        al_crear_suscripcion(
            serializer.instance,
            correlation_id=self.request.headers.get("X-Correlation-ID", ""),
        )

    def perform_destroy(self, instance: Subscription) -> None:
        """Desactiva la suscripción y conserva el registro y sus cobros históricos."""
        instance.activo = False
        instance.save()

    @action(detail=True, methods=["get", "post"], url_path="uso")
    def uso(self, request, pk=None):
        """
        GET /api/suscripciones/<id>/uso/
        Devuelve todos los registros de uso de esa suscripción ordenados por fecha
        del más reciente al más antiguo (CU-23 / RF-04 / RF-15).

        POST /api/suscripciones/<id>/uso/
        Registra minutos de uso para una suscripción (CU-23 / RF-15 / RF-16).
        - Persiste un registro histórico de uso.
        - Actualiza el campo 'ultima_actividad' con la fecha/hora actual.
        - Suma los minutos convertidos a horas en 'horas_uso_mes'.
        - Si la suscripción estaba en estado 'fantasma', la devuelve a 'activo' (CU-27 / RF-13).
        - No permite valores negativos ni cero en minutos (responde 400).
        """
        subscription = self.get_object()

        if request.method == "GET":
            usos = subscription.usos.all().order_by("-fecha", "-creado_en")
            serializer = RegistroUsoSerializer(usos, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = RegistrarUsoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        minutos = serializer.validated_data["minutos"]
        fecha = serializer.validated_data.get("fecha")
        subscription.registrar_uso(minutos, fecha=fecha)

        return Response(
            SubscriptionSerializer(subscription).data,
            status=status.HTTP_200_OK,
        )

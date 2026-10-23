"""Vistas del servicio de suscripciones."""

from calendar import monthrange
from datetime import date
import re
import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from drf_spectacular.utils import OpenApiParameter, extend_schema

from app.models import Cobro, Subscription
from app.serializers import (
    CalendarioCobroSerializer,
    RegistrarUsoSerializer,
    RegistroUsoSerializer,
    SolicitarTransicionSerializer,
    SubscriptionSerializer,
    TransicionEstadoSerializer,
)
from events.despacho import al_crear_suscripcion
from shared.tenant.base import TenantViewSet


def _fecha_proyectada_en_mes(
    suscripcion: Subscription, inicio: date, fin: date
) -> date | None:
    """Calcula la ocurrencia recurrente del mes sin desplazar el día ancla."""
    frecuencia_meses = {
        Subscription.Frecuencia.MENSUAL: 1,
        Subscription.Frecuencia.ANUAL: 12,
    }.get(suscripcion.frecuencia)
    if frecuencia_meses is None:
        raise ValidationError(
            {"frecuencia": f"Frecuencia no soportada: {suscripcion.frecuencia}."}
        )

    ancla = suscripcion.fecha_proximo_cobro
    if ancla > fin:
        return None

    diferencia_meses = (inicio.year - ancla.year) * 12 + inicio.month - ancla.month
    periodos = max(0, diferencia_meses // frecuencia_meses)

    while True:
        mes_indice = ancla.month - 1 + periodos * frecuencia_meses
        anio = ancla.year + mes_indice // 12
        mes = mes_indice % 12 + 1
        dia = min(ancla.day, monthrange(anio, mes)[1])
        fecha = date(anio, mes, dia)
        if fecha >= inicio:
            return fecha if fecha <= fin else None
        periodos += 1


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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="mes",
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description="Mes del calendario en formato YYYY-MM, por ejemplo 2026-12.",
            )
        ],
        responses=CalendarioCobroSerializer(many=True),
        description=(
            "Devuelve cobros confirmados y proyecciones mensuales/anuales de la "
            "organización. Solo incluye proyecciones desde hoy en adelante; si una "
            "suscripción ya tiene un cobro confirmado en el mes, no la proyecta."
        ),
    )
    @action(detail=False, methods=["get"], url_path="calendario-cobros")
    def calendario_cobros(self, request):
        """GET /api/suscripciones/calendario-cobros/?mes=YYYY-MM."""
        mes = request.query_params.get("mes", "")
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes):
            raise ValidationError({"mes": "Debe tener el formato YYYY-MM."})

        try:
            inicio = date.fromisoformat(f"{mes}-01")
        except ValueError:
            raise ValidationError({"mes": "Debe ser un mes válido en formato YYYY-MM."})

        fin = date(inicio.year, inicio.month, monthrange(inicio.year, inicio.month)[1])
        # Usa el queryset base para incluir pagos históricos de suscripciones ya dadas de baja.
        suscripciones_tenant = TenantViewSet.get_queryset(self)
        cobros = Cobro.objects.filter(
            organizacion_id=request.organizacion_id,
            suscripcion__in=suscripciones_tenant,
            fecha__range=(inicio, fin),
        ).select_related("suscripcion")
        eventos = [
            {
                "id": cobro.id,
                "suscripcion_id": cobro.suscripcion_id,
                "fecha": cobro.fecha,
                "servicio": cobro.suscripcion.nombre,
                "importe": cobro.monto,
                "moneda": cobro.moneda,
                "tipo": "confirmado",
            }
            for cobro in cobros
        ]
        suscripciones_confirmadas = {cobro.suscripcion_id for cobro in cobros}
        hoy = timezone.localdate()

        suscripciones_proyectables = (
            suscripciones_tenant.filter(activo=True)
            .exclude(estado=Subscription.Estado.CANCELADO)
        )
        for suscripcion in suscripciones_proyectables:
            fecha = _fecha_proyectada_en_mes(suscripcion, inicio, fin)
            if (
                fecha is None
                or fecha < hoy
                or suscripcion.id in suscripciones_confirmadas
            ):
                continue
            eventos.append(
                {
                    "id": suscripcion.id,
                    "suscripcion_id": suscripcion.id,
                    "fecha": fecha,
                    "servicio": suscripcion.nombre,
                    "importe": suscripcion.monto,
                    "moneda": suscripcion.moneda,
                    "tipo": "proyectado",
                }
            )

        eventos.sort(
            key=lambda evento: (
                evento["fecha"],
                evento["servicio"].casefold(),
                str(evento["id"]),
            )
        )
        serializer = CalendarioCobroSerializer(eventos, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @staticmethod
    def _actor_id(request, *, required: bool = False):
        actor_id = getattr(request, "usuario_id", None)
        if not actor_id:
            if required:
                raise PermissionDenied("Falta el contexto de usuario para auditar el evento.")
            return None
        try:
            return uuid.UUID(str(actor_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError({"actor_id": "El identificador de usuario no es válido."}) from exc

    @staticmethod
    def _convertir_error_transicion(error: DjangoValidationError) -> ValidationError:
        detail = error.message_dict if hasattr(error, "message_dict") else error.messages
        return ValidationError(detail)

    def perform_update(self, serializer) -> None:
        """Solo admite cambiar estado por eventos autorizados; mantiene PATCH de baja."""
        estado_solicitado = serializer.validated_data.pop("estado", None)

        with transaction.atomic():
            suscripcion = (
                type(serializer.instance)
                .objects.select_for_update()
                .get(pk=serializer.instance.pk)
            )
            serializer.instance = suscripcion

            if (
                estado_solicitado is not None
                and estado_solicitado != suscripcion.estado
                and estado_solicitado != Subscription.Estado.CANCELADO
            ):
                raise ValidationError(
                    {
                        "estado": (
                            "No se puede modificar el estado directamente. "
                            "Use el endpoint de transiciones."
                        )
                    }
                )

            serializer.save()
            if (
                estado_solicitado == Subscription.Estado.CANCELADO
                and estado_solicitado != suscripcion.estado
            ):
                actor_rol = getattr(self.request, "rol", None)
                if actor_rol not in ("titular", "integrante"):
                    raise PermissionDenied(
                        "El actor no tiene un rol válido para solicitar la cancelación."
                    )
                try:
                    suscripcion.transicionar(
                        Subscription.EventoEstado.CANCELACION_USUARIO,
                        actor_id=self._actor_id(self.request, required=True),
                        actor_rol=actor_rol,
                    )
                except DjangoValidationError as exc:
                    raise self._convertir_error_transicion(exc) from exc

    @action(detail=True, methods=["get", "post"], url_path="transiciones")
    def transiciones(self, request, pk=None):
        """
        GET devuelve el historial auditable; POST acepta confirmación de vigencia
        o cancelación por un usuario titular/integrante de la organización.
        Los eventos automáticos se aplican desde el servicio de dominio.
        """
        suscripcion = self.get_object()
        if request.method == "GET":
            historial = suscripcion.transiciones_estado.all()
            serializer = TransicionEstadoSerializer(historial, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = SolicitarTransicionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor_rol = getattr(request, "rol", None)
        if actor_rol not in ("titular", "integrante"):
            raise PermissionDenied("El actor no tiene un rol válido para este evento.")
        actor_id = self._actor_id(request, required=True)
        try:
            transicion = suscripcion.transicionar(
                serializer.validated_data["evento"],
                actor_id=actor_id,
                actor_rol=actor_rol,
            )
        except DjangoValidationError as exc:
            raise self._convertir_error_transicion(exc) from exc
        return Response(
            TransicionEstadoSerializer(transicion).data,
            status=status.HTTP_200_OK,
        )

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
        try:
            subscription.registrar_uso(
                minutos,
                fecha=fecha,
                actor_id=self._actor_id(request),
                actor_rol=getattr(request, "rol", None) or "sin_identificar",
            )
        except DjangoValidationError as exc:
            raise self._convertir_error_transicion(exc) from exc

        return Response(
            SubscriptionSerializer(subscription).data,
            status=status.HTTP_200_OK,
        )

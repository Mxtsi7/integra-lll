"""Vistas del servicio de suscripciones."""

from calendar import monthrange
from datetime import date
import re
import uuid

from decimal import Decimal
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from events.outbox import registrar_actualizada, registrar_creada
from drf_spectacular.utils import OpenApiParameter, extend_schema

from app.models import Cobro, Presupuesto, Subscription
from app.serializers import (
    CalendarioCobroSerializer,
    CobroSerializer,
    PresupuestoComparacionSerializer,
    PresupuestoSerializer,
    RegistrarUsoSerializer,
    RegistroUsoSerializer,
    ResumenPanelSerializer,
    SolicitarTransicionSerializer,
    SubscriptionSerializer,
    TransicionEstadoSerializer,
)
from shared.tenant.base import TenantViewSet


def _resolver_rango_mes(mes: str | None = None) -> tuple[date, date, str]:
    """Valida o infiere el mes en formato YYYY-MM y devuelve (inicio, fin, mes)."""
    if not mes:
        hoy = timezone.localdate()
        mes = f"{hoy.year:04d}-{hoy.month:02d}"
    elif not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes):
        raise ValidationError({"mes": "Debe tener el formato YYYY-MM."})

    try:
        inicio = date.fromisoformat(f"{mes}-01")
    except ValueError:
        raise ValidationError({"mes": "Debe ser un mes válido en formato YYYY-MM."})

    fin = date(inicio.year, inicio.month, monthrange(inicio.year, inicio.month)[1])
    return inicio, fin, mes


def _calcular_gasto_proyectado(
    suscripciones, inicio: date, fin: date, suscripciones_con_cobro: set
) -> Decimal:
    """Calcula la suma de montos proyectados en el rango para suscripciones sin cobro confirmado."""
    hoy = timezone.localdate()
    total_proyectado = Decimal("0.00")
    for suscripcion in suscripciones:
        fecha = _fecha_proyectada_en_mes(suscripcion, inicio, fin)
        if fecha is None or fecha < hoy or suscripcion.id in suscripciones_con_cobro:
            continue
        total_proyectado += suscripcion.monto
    return total_proyectado


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

        # VI-01: Búsqueda server-side por nombre (insensible a mayúsculas, limitada a 100 caracteres)
        nombre = self.request.query_params.get("nombre")
        if nombre is None:
            nombre = self.request.query_params.get("search")
        if nombre is not None:
            nombre_limpio = nombre.strip()[:100]
            if nombre_limpio:
                qs = qs.filter(nombre__icontains=nombre_limpio)

        # VI-02: Ordenamiento server-side con allowlist y desempate estable por id
        orden = self.request.query_params.get("orden")
        if orden is None:
            orden = self.request.query_params.get("ordering")
        if orden is not None and orden.strip():
            orden_param = orden.strip()
            orden_normalizado = orden_param
            if orden_param in ("fecha_cobro", "+fecha_cobro"):
                orden_normalizado = "fecha_proximo_cobro"
            elif orden_param == "-fecha_cobro":
                orden_normalizado = "-fecha_proximo_cobro"

            campos_permitidos = {
                "nombre", "-nombre",
                "monto", "-monto",
                "fecha_proximo_cobro", "-fecha_proximo_cobro",
            }
            if orden_normalizado not in campos_permitidos:
                raise ValidationError(
                    {
                        "orden": (
                            f"Campo de orden no permitido: '{orden_param}'. "
                            "Campos válidos: nombre, monto, fecha_proximo_cobro "
                            "(use prefijo '-' para orden descendente)."
                        )
                    }
                )

            desempate = "-id" if orden_normalizado.startswith("-") else "id"
            qs = qs.order_by(orden_normalizado, desempate)

        return qs

    def perform_destroy(self, instance: Subscription) -> None:
        """Desactiva la suscripción y conserva el registro y sus cobros históricos."""
        instance.activo = False
        instance.save()

    def perform_create(self, serializer) -> None:
        with transaction.atomic():
            super().perform_create(serializer)
            registrar_creada(
                serializer.instance,
                correlation_id=self._correlation_id(self.request),
            )

    @staticmethod
    def _correlation_id(request) -> uuid.UUID:
        correlation_id = getattr(request, "correlation_id", None)
        if not correlation_id:
            return uuid.uuid4()
        try:
            return uuid.UUID(str(correlation_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError(
                {"correlation_id": "El identificador de correlación no es válido."}
            ) from exc

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

    @extend_schema(
        responses=CobroSerializer(many=True),
        description="Consulta el histórico de cobros reales de una suscripción propia (VI-04 / RF-05).",
    )
    @action(detail=True, methods=["get"], url_path="cobros")
    def cobros(self, request, pk=None):
        """GET /api/suscripciones/<id>/cobros/ (VI-04 / RF-05)."""
        suscripcion = self.get_object()
        qs = suscripcion.cobros.all().order_by("-fecha", "-id")

        desde = request.query_params.get("desde")
        if desde:
            fecha_desde = parse_date(desde)
            if not fecha_desde:
                raise ValidationError({"desde": "Debe tener el formato YYYY-MM-DD."})
            qs = qs.filter(fecha__gte=fecha_desde)

        hasta = request.query_params.get("hasta")
        if hasta:
            fecha_hasta = parse_date(hasta)
            if not fecha_hasta:
                raise ValidationError({"hasta": "Debe tener el formato YYYY-MM-DD."})
            qs = qs.filter(fecha__lte=fecha_hasta)

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = CobroSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = CobroSerializer(qs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        parameters=[
            OpenApiParameter(name="mes", type=str, location=OpenApiParameter.QUERY, required=False),
            OpenApiParameter(name="moneda", type=str, location=OpenApiParameter.QUERY, required=False),
        ],
        responses=PresupuestoComparacionSerializer,
        description="Compara el presupuesto mensual con el gasto real y proyectado (VI-05).",
    )
    @action(detail=False, methods=["get", "post"], url_path="presupuesto")
    def presupuesto(self, request):
        """GET /api/suscripciones/presupuesto/ y POST /api/suscripciones/presupuesto/ (VI-05)."""
        if request.method == "POST":
            # Validar que existe contexto de organización antes de persistir.
            # Sin X-Organizacion-Id llegaría organizacion_id=None al
            # update_or_create y lanzaría IntegrityError (500). El README
            # promete 403.
            if not getattr(request, "organizacion_id", None):
                raise PermissionDenied("La cabecera X-Organizacion-Id es obligatoria.")
            serializer = PresupuestoSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            mes = serializer.validated_data["mes"]
            moneda = serializer.validated_data.get("moneda", "CLP")
            monto = serializer.validated_data["monto"]

            presupuesto_obj, _ = Presupuesto.objects.update_or_create(
                organizacion_id=request.organizacion_id,
                mes=mes,
                moneda=moneda,
                defaults={"monto": monto},
            )
            return Response(PresupuestoSerializer(presupuesto_obj).data, status=status.HTTP_200_OK)

        # GET: Comparar presupuesto vs proyección
        mes_param = request.query_params.get("mes")
        moneda = (request.query_params.get("moneda") or "CLP").upper()
        if moneda not in {"CLP", "USD"}:
            raise ValidationError({"moneda": f"Moneda no válida: '{moneda}'. Opciones: CLP, USD."})

        inicio, fin, mes = _resolver_rango_mes(mes_param)

        presupuesto_obj = Presupuesto.objects.filter(
            organizacion_id=request.organizacion_id,
            mes=mes,
            moneda=moneda,
        ).first()

        suscripciones_tenant = TenantViewSet.get_queryset(self).filter(moneda=moneda)
        cobros = Cobro.objects.filter(
            organizacion_id=request.organizacion_id,
            moneda=moneda,
            fecha__range=(inicio, fin),
        )
        gasto_real = cobros.aggregate(total=Sum("monto"))["total"] or Decimal("0.00")
        suscripciones_con_cobro = set(cobros.values_list("suscripcion_id", flat=True))

        suscripciones_proyectables = (
            suscripciones_tenant.filter(activo=True)
            .exclude(estado=Subscription.Estado.CANCELADO)
        )
        gasto_proyectado = _calcular_gasto_proyectado(
            suscripciones_proyectables, inicio, fin, suscripciones_con_cobro
        )
        total_esperado = gasto_real + gasto_proyectado

        if presupuesto_obj:
            presupuesto_monto = presupuesto_obj.monto
            diferencia = presupuesto_monto - total_esperado
            porcentaje = (
                round(float((total_esperado / presupuesto_monto) * 100), 2)
                if presupuesto_monto > 0
                else 0.0
            )
            alerta = total_esperado > presupuesto_monto
        else:
            presupuesto_monto = None
            diferencia = None
            porcentaje = 0.0
            alerta = False

        datos = {
            "mes": mes,
            "moneda": moneda,
            "presupuesto": presupuesto_monto,
            "gasto_real": gasto_real,
            "gasto_proyectado": gasto_proyectado,
            "total_esperado": total_esperado,
            "diferencia": diferencia,
            "porcentaje_consumido": porcentaje,
            "alerta_superado": alerta,
        }
        return Response(PresupuestoComparacionSerializer(datos).data, status=status.HTTP_200_OK)

    @extend_schema(
        parameters=[
            OpenApiParameter(name="mes", type=str, location=OpenApiParameter.QUERY, required=False),
            OpenApiParameter(name="moneda", type=str, location=OpenApiParameter.QUERY, required=False),
        ],
        responses=ResumenPanelSerializer,
        description="Resumen agregado del panel con gasto real, proyección y conteo por estado (VI-06).",
    )
    @action(detail=False, methods=["get"], url_path="resumen")
    def resumen(self, request):
        """GET /api/suscripciones/resumen/ (VI-06 / RF-11 / RF-09)."""
        mes_param = request.query_params.get("mes")
        moneda = (request.query_params.get("moneda") or "CLP").upper()
        if moneda not in {"CLP", "USD"}:
            raise ValidationError({"moneda": f"Moneda no válida: '{moneda}'. Opciones: CLP, USD."})

        inicio, fin, periodo = _resolver_rango_mes(mes_param)

        cobros = Cobro.objects.filter(
            organizacion_id=request.organizacion_id,
            moneda=moneda,
            fecha__range=(inicio, fin),
        )
        gasto_real = cobros.aggregate(total=Sum("monto"))["total"] or Decimal("0.00")
        suscripciones_con_cobro = set(cobros.values_list("suscripcion_id", flat=True))

        suscripciones_tenant = TenantViewSet.get_queryset(self)
        suscripciones_proyectables = (
            suscripciones_tenant.filter(activo=True, moneda=moneda)
            .exclude(estado=Subscription.Estado.CANCELADO)
        )
        gasto_proyectado = _calcular_gasto_proyectado(
            suscripciones_proyectables, inicio, fin, suscripciones_con_cobro
        )
        total_estimado = gasto_real + gasto_proyectado

        # Bloqueante 2: TenantViewSet.get_queryset(self) no filtra activo=True;
        # una suscripción con DELETE (soft-delete) seguía sumando en el conteo.
        suscripciones_tenant_activas = TenantViewSet.get_queryset(self).filter(activo=True)
        conteo_estados = {
            "activo": 0,
            "prueba": 0,
            "por_confirmar": 0,
            "cancelado": 0,
            "fantasma": 0,
            "total": 0,
        }
        for suscripcion in suscripciones_tenant_activas:
            estado = suscripcion.estado
            if estado in conteo_estados:
                conteo_estados[estado] += 1
            conteo_estados["total"] += 1

        datos = {
            "periodo": periodo,
            "moneda": moneda,
            "gasto_real": gasto_real,
            "gasto_proyectado": gasto_proyectado,
            "total_estimado": total_estimado,
            "conteo_estados": conteo_estados,
        }
        return Response(ResumenPanelSerializer(datos).data, status=status.HTTP_200_OK)

    @staticmethod
    def _actor_id(request, *, required: bool = False):
        actor_id = getattr(request, "usuario_id", None)
        if not actor_id:
            if required:
                raise PermissionDenied("Falta el contexto de usuario para auditar el evento.")
            return None
        try:
            val = int(actor_id)
            if val <= 0:
                raise ValueError
            return val
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
            valores_anteriores = {
                "proveedor_id": suscripcion.proveedor_id,
                "nombre": suscripcion.nombre,
                "monto": suscripcion.monto,
                "moneda": suscripcion.moneda,
                "frecuencia": suscripcion.frecuencia,
                "fecha_proximo_cobro": suscripcion.fecha_proximo_cobro,
            }

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
                        correlation_id=self._correlation_id(self.request),
                    )
                except DjangoValidationError as exc:
                    raise self._convertir_error_transicion(exc) from exc

            nombres_evento = {
                "proveedor_id": "proveedor_id",
                "nombre": "nombre",
                "monto": "monto",
                "moneda": "moneda",
                "frecuencia": "ciclo",
                "fecha_proximo_cobro": "proximo_cobro",
            }
            campos_modificados = [
                nombres_evento[campo]
                for campo, valor_anterior in valores_anteriores.items()
                if getattr(suscripcion, campo) != valor_anterior
            ]
            if campos_modificados:
                registrar_actualizada(
                    suscripcion,
                    campos_modificados,
                    correlation_id=self._correlation_id(self.request),
                )

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
                correlation_id=self._correlation_id(request),
            )
        except DjangoValidationError as exc:
            raise self._convertir_error_transicion(exc) from exc
        return Response(
            TransicionEstadoSerializer(transicion).data,
            status=status.HTTP_200_OK,
        )

    @extend_schema(
        responses=SubscriptionSerializer,
        description="Cancela una suscripción propia sin hacer soft-delete (VI-03 / RF-10).",
    )
    @action(detail=True, methods=["post"], url_path="cancelar")
    def cancelar(self, request, pk=None):
        """POST /api/suscripciones/<id>/cancelar/ (VI-03 / RF-10)."""
        suscripcion = self.get_object()
        actor_rol = getattr(request, "rol", None)
        if actor_rol not in ("titular", "integrante"):
            raise PermissionDenied("El actor no tiene un rol válido para solicitar la cancelación.")

        actor_id = self._actor_id(request, required=True)
        correlation_id = self._correlation_id(request)

        with transaction.atomic():
            suscripcion_bloqueada = (
                type(suscripcion)
                .objects.select_for_update()
                .get(pk=suscripcion.pk)
            )
            # Idempotencia bajo bloqueo: si ya está cancelada, responde 200 sin duplicar transiciones ni outbox
            if suscripcion_bloqueada.estado == Subscription.Estado.CANCELADO:
                return Response(SubscriptionSerializer(suscripcion_bloqueada).data, status=status.HTTP_200_OK)

            try:
                suscripcion_bloqueada.transicionar(
                    Subscription.EventoEstado.CANCELACION_USUARIO,
                    actor_id=actor_id,
                    actor_rol=actor_rol,
                    correlation_id=correlation_id,
                )
            except DjangoValidationError as exc:
                raise self._convertir_error_transicion(exc) from exc

        return Response(SubscriptionSerializer(suscripcion_bloqueada).data, status=status.HTTP_200_OK)

    @extend_schema(
        responses=SubscriptionSerializer,
        description="Reactiva o confirma cobro detectado para una suscripción (VI-09).",
    )
    @action(detail=True, methods=["post"], url_path="reactivar")
    def reactivar(self, request, pk=None):
        """POST /api/suscripciones/<id>/reactivar/ (VI-09)."""
        suscripcion = self.get_object()
        actor_rol = getattr(request, "rol", None)
        if actor_rol not in ("titular", "integrante"):
            raise PermissionDenied("El actor no tiene un rol válido para reactivar la suscripción.")

        actor_id = self._actor_id(request, required=True)
        correlation_id = self._correlation_id(request)

        with transaction.atomic():
            suscripcion_bloqueada = (
                type(suscripcion)
                .objects.select_for_update()
                .get(pk=suscripcion.pk)
            )
            # Idempotencia bajo bloqueo: si ya está activa, responde 200 sin duplicar auditoría ni outbox
            if suscripcion_bloqueada.estado == Subscription.Estado.ACTIVO:
                return Response(SubscriptionSerializer(suscripcion_bloqueada).data, status=status.HTTP_200_OK)

            try:
                suscripcion_bloqueada.transicionar(
                    Subscription.EventoEstado.COBRO_NUEVO_DETECTADO,
                    actor_id=actor_id,
                    actor_rol=actor_rol,
                    correlation_id=correlation_id,
                )
            except DjangoValidationError as exc:
                raise self._convertir_error_transicion(exc) from exc

        return Response(SubscriptionSerializer(suscripcion_bloqueada).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get", "post"], url_path="uso")
    def uso(self, request, pk=None):
        """
        GET /api/suscripciones/<id>/uso/
        Devuelve todos los registros de uso de esa suscripción ordenados por fecha
        del más reciente al más antiguo (CU-23 / RF-04 / RF-15).

        POST /api/suscripciones/<id>/uso/
        Registra minutos de uso para una suscripción (CU-23 / RF-04 / RF-15 / RF-16).
        - Persiste un registro histórico de uso; ``fecha`` es opcional y no puede
          ser futura.
        - Actualiza ``ultima_actividad`` con la fecha/hora de registro.
        - Recalcula ``horas_uso_mes`` desde los registros del mes local actual.
        - Si la suscripción estaba en estado 'fantasma', la devuelve a 'activo' (CU-27 / RF-13).
        - Rechaza minutos no positivos, fuera del máximo o fechas inválidas (400).
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
                correlation_id=self._correlation_id(request),
            )
        except DjangoValidationError as exc:
            raise self._convertir_error_transicion(exc) from exc

        return Response(
            SubscriptionSerializer(subscription).data,
            status=status.HTTP_200_OK,
        )

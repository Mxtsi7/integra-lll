"""Vistas del servicio de suscripciones."""

from calendar import monthrange
from datetime import date, timedelta
import re
import uuid

from decimal import Decimal
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from events.outbox import registrar_actualizada, registrar_creada
from events.modo import al_crear_suscripcion
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)

from app.anomalias import marcar_hallazgo_revisado
from app.exportacion import (
    construir_csv_cobros,
    normalizar_moneda,
    normalizar_origen,
)
from app.models import (
    Cobro,
    HallazgoCobro,
    Moneda,
    Presupuesto,
    RegistroUso,
    Subscription,
)
from app.serializers import (
    CalendarioCobroSerializer,
    CobroSerializer,
    HallazgoCobroSerializer,
    PaginatedCobroSerializer,
    PaginatedHallazgoSerializer,
    PaginatedSubscriptionSerializer,
    PresupuestoComparacionSerializer,
    PresupuestoSerializer,
    RegistrarCobroSerializer,
    RegistrarUsoSerializer,
    RegistroUsoSerializer,
    ResumenPanelSerializer,
    SolicitarTransicionSerializer,
    SubscriptionSerializer,
    TransicionEstadoSerializer,
)
from shared.tenant.base import SoloLecturaTenantViewSet, TenantViewSet


class PaginacionExplicitaMixin:
    """Documenta el sobre paginado sin que drf-spectacular lo envuelva dos veces.

    Los serializers ``Paginated*`` ya describen ``count``/``next``/``previous``/
    ``results``. Durante la introspección del esquema (``swagger_fake_view``)
    se desactiva la paginación automática para que no genere un
    ``PaginatedPaginated...``; en runtime se sigue usando la clase indicada en
    ``_pagination_class``.
    """

    _pagination_class = None

    @property
    def pagination_class(self):
        if getattr(self, "swagger_fake_view", False):
            return None
        return self._pagination_class


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


def _resolver_rango_exportacion(request) -> tuple[date, date]:
    """Valida el rango inclusivo ``desde``/``hasta`` de la exportación CSV.

    Se aceptan también los alias ``fecha_desde`` y ``fecha_hasta`` para que el
    cliente pueda reutilizar los nombres del histórico de cobros. Ambos
    extremos son obligatorios: exportar "todo" sin rango es una operación
    costosa y fácil de pedir por accidente.
    """
    desde_raw = request.query_params.get("desde") or request.query_params.get(
        "fecha_desde"
    )
    hasta_raw = request.query_params.get("hasta") or request.query_params.get(
        "fecha_hasta"
    )

    errores = {}
    try:
        desde = parse_date(desde_raw) if desde_raw else None
        hasta = parse_date(hasta_raw) if hasta_raw else None
    except (TypeError, ValueError):
        # ``parse_date`` lanza ValueError para una fecha bien formada pero
        # imposible (2026-13-45); el contrato de la API es 400, no 500.
        desde = hasta = None
    if not desde:
        errores["desde"] = "Es obligatorio y debe tener el formato YYYY-MM-DD."
    if not hasta:
        errores["hasta"] = "Es obligatorio y debe tener el formato YYYY-MM-DD."
    if errores:
        raise ValidationError(errores)

    if desde > hasta:
        raise ValidationError(
            {"hasta": "Debe ser igual o posterior a la fecha 'desde'."}
        )
    return desde, hasta


def _resolver_filtros_exportacion(
    request,
) -> tuple[date, date, str | None, str | None]:
    """Valida y normaliza todos los filtros del CSV en un solo lugar.

    Ambas rutas de exportación comparten esta función para que el contrato no
    diverja: rango inclusivo obligatorio, moneda contra el catálogo activo y
    origen contra los valores soportados. Un filtro inválido es 400.
    """
    desde, hasta = _resolver_rango_exportacion(request)
    try:
        moneda = normalizar_moneda(request.query_params.get("moneda"))
        origen = normalizar_origen(request.query_params.get("origen"))
    except DjangoValidationError as exc:
        raise ValidationError(
            getattr(exc, "message_dict", None) or {"detail": exc.messages}
        ) from exc
    return desde, hasta, moneda, origen


def _respuesta_csv_cobros(
    request,
    desde: date,
    hasta: date,
    moneda: str | None = None,
    origen: str | None = None,
) -> HttpResponse:
    """Construye la respuesta HTTP del CSV con los cobros del tenant."""
    if not getattr(request, "organizacion_id", None):
        raise PermissionDenied("La cabecera X-Organizacion-Id es obligatoria.")

    contenido = construir_csv_cobros(
        request.organizacion_id,
        desde,
        hasta,
        moneda=moneda,
        origen=origen,
    )
    respuesta = HttpResponse(
        contenido,
        content_type="text/csv; charset=utf-8",
    )
    respuesta["Content-Disposition"] = (
        f'attachment; filename="cobros_{desde.isoformat()}_{hasta.isoformat()}.csv"'
    )
    return respuesta


def _actor_id_opcional(request) -> int | None:
    """Convierte X-Usuario-Id a entero sin impedir una revisión sin auditoría."""
    actor_id = getattr(request, "usuario_id", None)
    if not actor_id:
        return None
    try:
        valor = int(actor_id)
    except (TypeError, ValueError):
        return None
    return valor if valor > 0 else None


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


_EJEMPLO_SUSCRIPCION = {
    "id": "6f1c2a7e-8b4d-4c1a-9f2e-3a5b7c9d1e2f",
    "organizacion_id": "11111111-1111-4111-8111-111111111111",
    "nombre": "Netflix Premium",
    "monto": "12990.00",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-05",
    "categoria": "streaming",
    "proveedor": None,
    "estado": "activo",
    "activo": True,
    "fin_prueba": None,
    "horas_uso_mes": "12.50",
    "ultima_actividad": "2026-10-20T18:30:00-03:00",
    "creado_en": "2026-09-01T10:00:00-03:00",
    "actualizado_en": "2026-10-20T18:30:00-03:00",
}


@extend_schema_view(
    list=extend_schema(
        summary="Listar suscripciones activas",
        description=(
            "Devuelve las suscripciones **no eliminadas** de la organización "
            "autenticada. Las canceladas siguen apareciendo (``activo=true``); "
            "las que se dieron de baja con ``DELETE`` no (``activo=false``).\n\n"
            "**Combinaciones de filtros**\n\n"
            "| Parámetros | Resultado |\n"
            "|---|---|\n"
            "| *(ninguno)* | Todas las activas de la organización. |\n"
            "| ``estado=activo`` | Solo ese estado. |\n"
            "| ``fecha_cobro=2026-11-05`` | Cobros en esa fecha exacta. |\n"
            "| ``nombre=net`` | Nombre que contiene el texto (sin distinguir mayúsculas). |\n"
            "| ``nombre=net&estado=activo`` | Ambos filtros a la vez. |\n"
            "| ``nombre=net&orden=-monto&page=2`` | Filtro, orden y página. |\n\n"
            "``search`` es alias de ``nombre``; ``ordering`` es alias de "
            "``orden``; ``fecha_proximo_cobro`` es alias de ``fecha_cobro``.\n\n"
            "**Paginación:** ``page`` empieza en 1. ``page_size`` vale 10 por "
            "defecto y admite hasta 100. La respuesta siempre tiene "
            "``count``, ``next``, ``previous`` y ``results``. Los ejemplos usan "
            "rutas relativas para no exponer hosts internos ni IPs de Docker."
        ),
        parameters=[
            OpenApiParameter(
                name="estado",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                enum=[e.value for e in Subscription.Estado],
                description="Filtra por estado del ciclo de vida.",
                examples=[OpenApiExample("Activas", value="activo")],
            ),
            OpenApiParameter(
                name="nombre",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Búsqueda parcial por nombre, insensible a mayúsculas. "
                    "Se recortan los espacios y se usan como máximo 100 "
                    "caracteres."
                ),
                examples=[OpenApiExample("Netflix", value="netflix")],
            ),
            OpenApiParameter(
                name="search",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Alias de ``nombre``.",
            ),
            OpenApiParameter(
                name="fecha_cobro",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Fecha exacta del próximo cobro (YYYY-MM-DD).",
                examples=[OpenApiExample("Noviembre", value="2026-11-05")],
            ),
            OpenApiParameter(
                name="fecha_proximo_cobro",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Alias de ``fecha_cobro``.",
            ),
            OpenApiParameter(
                name="orden",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                enum=[
                    "nombre",
                    "-nombre",
                    "monto",
                    "-monto",
                    "fecha_proximo_cobro",
                    "-fecha_proximo_cobro",
                    "fecha_cobro",
                    "-fecha_cobro",
                ],
                description=(
                    "Orden server-side. El prefijo ``-`` indica descendente. "
                    "Los empates se resuelven por ``id`` para que la "
                    "paginación sea estable."
                ),
                examples=[OpenApiExample("Mayor monto", value="-monto")],
            ),
            OpenApiParameter(
                name="ordering",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Alias de ``orden``.",
            ),
            OpenApiParameter(
                name="page",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Número de página, desde 1.",
            ),
            OpenApiParameter(
                name="page_size",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Tamaño de página (1 a 100; por defecto 10).",
            ),
        ],
        responses={
            200: OpenApiResponse(
                response=PaginatedSubscriptionSerializer,
                description="Página de suscripciones de la organización.",
                examples=[
                    OpenApiExample(
                        "Página 1 con dos resultados",
                        value={
                            "count": 2,
                            "next": "/api/suscripciones/?page=2",
                            "previous": None,
                            "results": [_EJEMPLO_SUSCRIPCION],
                        },
                        response_only=True,
                    )
                ],
            ),
            400: OpenApiResponse(
                description=(
                    "Parámetro inválido, por ejemplo una fecha mal formada o "
                    "un campo de orden fuera de la lista permitida."
                )
            ),
            403: OpenApiResponse(
                description="Falta la cabecera X-Organizacion-Id."
            ),
        },
    ),
)
class SubscriptionViewSet(PaginacionExplicitaMixin, TenantViewSet):
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
        ?nombre=netflix           (alias search; VI-01)
        ?orden=-monto             (alias ordering; VI-02)
    - Expone GET y POST /api/suscripciones/<id>/cobros/ para el histórico y
      el registro de cobros (VI-04 / VI-19).
    - Expone GET y POST /api/suscripciones/<id>/uso/ para consultar el
      histórico y registrar minutos de uso.
    - Expone GET /api/suscripciones/exportar-csv/ (VI-25) y el alias
      /api/export/cobros/.
    """

    queryset = Subscription.objects.all()
    serializer_class = SubscriptionSerializer
    _pagination_class = SubscriptionPagination

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
            evento = registrar_creada(
                serializer.instance,
                correlation_id=self._correlation_id(self.request),
            )
            # El trabajo derivado va DENTRO de la transacción a propósito
            # cuando EVENTOS_ASINCRONOS=0: ese acoplamiento es exactamente
            # lo que el modo asíncrono elimina, y es lo que la prueba de
            # comparación mide. Con la bandera en 1 no hace nada acá.
            # Recibe el evento para acreditar el trabajo CONTRA ese evento,
            # en esta misma transacción (ver events/modo.py).
            self._modo_despacho = al_crear_suscripcion(serializer.instance, evento)

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
        responses={
            200: OpenApiResponse(
                response=CalendarioCobroSerializer(many=True),
                description="Eventos del mes ordenados por fecha y servicio.",
                examples=[
                    OpenApiExample(
                        "Mes con un cobro confirmado y una proyección",
                        value=[
                            {
                                "id": "0d6f7e8a-1b2c-4d3e-8f90-1a2b3c4d5e6f",
                                "suscripcion_id": "6f1c2a7e-8b4d-4c1a-9f2e-3a5b7c9d1e2f",
                                "fecha": "2026-11-05",
                                "servicio": "Netflix Premium",
                                "importe": "12990.00",
                                "moneda": "CLP",
                                "tipo": "confirmado",
                            }
                        ],
                        response_only=True,
                    )
                ],
            ),
            400: OpenApiResponse(
                description="``mes`` ausente o con formato distinto de YYYY-MM."
            ),
        },
        description=(
            "Devuelve cobros confirmados y proyecciones mensuales/anuales de la "
            "organización (VI-07). ``mes`` es obligatorio y usa el formato "
            "``YYYY-MM``. Solo incluye proyecciones desde hoy en adelante; si "
            "una suscripción ya tiene un cobro confirmado en el mes, no la "
            "proyecta. Los cobros históricos de suscripciones dadas de baja "
            "siguen apareciendo como ``confirmado``."
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
        summary="Consultar o registrar cobros de una suscripción",
        description=(
            "**GET** devuelve el histórico real de una suscripción propia, "
            "del más reciente al más antiguo (VI-04 / RF-05). Admite "
            "``desde`` y ``hasta`` inclusivos y usa la misma paginación del "
            "listado (``page``/``page_size``, máximo 100). La respuesta tiene "
            "``count``, ``next``, ``previous`` y ``results``.\n\n"
            "**POST** registra un cobro con ``monto`` y ``fecha`` "
            "obligatorios. La moneda es opcional y, si no se envía, hereda la "
            "de la suscripción. Al crear el cobro se ejecuta la detección de "
            "alzas y posibles dobles cobros (VI-19).\n\n"
            "Un recurso de otra organización responde 404."
        ),
        parameters=[
            OpenApiParameter(
                name="desde",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Fecha inicial inclusiva (YYYY-MM-DD).",
            ),
            OpenApiParameter(
                name="hasta",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Fecha final inclusiva (YYYY-MM-DD).",
            ),
            OpenApiParameter(
                name="page",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Número de página, desde 1.",
            ),
            OpenApiParameter(
                name="page_size",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Tamaño de página (1 a 100; por defecto 10).",
            ),
        ],
        request=RegistrarCobroSerializer,
        responses={
            200: OpenApiResponse(
                response=PaginatedCobroSerializer,
                description="Histórico paginado de cobros.",
                examples=[
                    OpenApiExample(
                        "GET con dos cobros",
                        value={
                            "count": 2,
                            "next": None,
                            "previous": None,
                            "results": [
                                {
                                    "id": "0d6f7e8a-1b2c-4d3e-8f90-1a2b3c4d5e6f",
                                    "suscripcion_id": "6f1c2a7e-8b4d-4c1a-9f2e-3a5b7c9d1e2f",
                                    "monto": "12990.00",
                                    "moneda": "CLP",
                                    "fecha": "2026-10-05",
                                    "creado_en": "2026-10-05T09:15:00-03:00",
                                }
                            ],
                        },
                        response_only=True,
                    )
                ],
            ),
            201: OpenApiResponse(
                response=CobroSerializer,
                description="Cobro registrado; la detección de anomalías ya se ejecutó.",
                examples=[
                    OpenApiExample(
                        "Cobro creado",
                        value={
                            "id": "0d6f7e8a-1b2c-4d3e-8f90-1a2b3c4d5e6f",
                            "suscripcion_id": "6f1c2a7e-8b4d-4c1a-9f2e-3a5b7c9d1e2f",
                            "monto": "12990.00",
                            "moneda": "CLP",
                            "fecha": "2026-10-05",
                            "creado_en": "2026-10-05T09:15:00-03:00",
                        },
                        response_only=True,
                    )
                ],
            ),
            400: OpenApiResponse(
                description="Monto, fecha o rango de fechas inválido."
            ),
            404: OpenApiResponse(
                description="La suscripción no existe o pertenece a otra organización."
            ),
        },
    )
    @action(detail=True, methods=["get", "post"], url_path="cobros")
    def cobros(self, request, pk=None):
        """GET/POST /api/suscripciones/<id>/cobros/ (VI-04 / RF-05 / VI-19)."""
        suscripcion = self.get_object()

        if request.method == "POST":
            entrada = RegistrarCobroSerializer(
                data=request.data,
                context={"suscripcion": suscripcion},
            )
            entrada.is_valid(raise_exception=True)
            try:
                # El cobro y la detección que dispara su señal post_save
                # comparten transacción: si la detección falla, no queda un
                # cobro persistido con un error visible para el cliente (un
                # reintento no debe duplicarlo).
                with transaction.atomic():
                    cobro = Cobro.objects.create(
                        organizacion_id=request.organizacion_id,
                        suscripcion=suscripcion,
                        monto=entrada.validated_data["monto"],
                        moneda=(
                            entrada.validated_data.get("moneda")
                            or suscripcion.moneda
                        ),
                        fecha=entrada.validated_data["fecha"],
                    )
            except DjangoValidationError as exc:
                # El catálogo también valida en el ORM (por ejemplo, si la
                # moneda se desactiva entre la validación y el guardado).
                raise ValidationError(
                    getattr(exc, "message_dict", None) or exc.messages
                ) from exc
            return Response(
                CobroSerializer(cobro).data,
                status=status.HTTP_201_CREATED,
            )

        qs = suscripcion.cobros.all().order_by("-fecha", "-id")

        desde = request.query_params.get("desde")
        if desde:
            try:
                fecha_desde = parse_date(desde)
            except ValueError:
                fecha_desde = None
            if not fecha_desde:
                raise ValidationError({"desde": "Debe tener el formato YYYY-MM-DD."})
            qs = qs.filter(fecha__gte=fecha_desde)

        hasta = request.query_params.get("hasta")
        if hasta:
            try:
                fecha_hasta = parse_date(hasta)
            except ValueError:
                fecha_hasta = None
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
            suscripcion__activo=True,
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
            OpenApiParameter(
                name="mes",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Periodo en formato YYYY-MM. Si se omite, se usa el mes "
                    "local actual."
                ),
                examples=[OpenApiExample("Noviembre 2026", value="2026-11")],
            ),
            OpenApiParameter(
                name="moneda",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                enum=["CLP", "USD"],
                description="Moneda del resumen (por defecto CLP).",
            ),
        ],
        responses={
            200: OpenApiResponse(
                response=ResumenPanelSerializer,
                description="Gasto real, proyectado y conteo por estado.",
                examples=[
                    OpenApiExample(
                        "Resumen de noviembre",
                        value={
                            "periodo": "2026-11",
                            "moneda": "CLP",
                            "gasto_real": "25000.00",
                            "gasto_proyectado": "12990.00",
                            "total_estimado": "37990.00",
                            "conteo_estados": {
                                "activo": 2,
                                "prueba": 0,
                                "por_confirmar": 0,
                                "cancelado": 1,
                                "fantasma": 0,
                                "total": 3,
                            },
                        },
                        response_only=True,
                    )
                ],
            ),
            400: OpenApiResponse(
                description="``mes`` o ``moneda`` inválidos."
            ),
        },
        description=(
            "Resumen agregado del panel con gasto real, proyección y conteo "
            "por estado (VI-06 / RF-11 / RF-09). Excluye suscripciones con "
            "``activo=false`` (eliminadas lógicamente); las canceladas sí "
            "cuentan en ``conteo_estados.cancelado``."
        ),
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
            suscripcion__activo=True,
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
        description="Reactiva una suscripción cancelada a activo a solicitud del usuario (VI-09).",
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
                    Subscription.EventoEstado.REACTIVACION_USUARIO,
                    actor_id=actor_id,
                    actor_rol=actor_rol,
                    correlation_id=correlation_id,
                )
            except DjangoValidationError as exc:
                raise self._convertir_error_transicion(exc) from exc

        return Response(SubscriptionSerializer(suscripcion_bloqueada).data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Exportar cobros a CSV",
        description=(
            "Descarga **todos** los cobros de la organización en el rango "
            "inclusivo ``desde``..``hasta`` (VI-25 / RF-15). No aplica la "
            "paginación de la API: una exportación de marzo a agosto incluye "
            "todas las filas, no solo la primera página.\n\n"
            "Columnas: ``servicio,categoria,monto,moneda,fecha,origen,estado``. "
            "El filtro por organización se aplica al cobro y a su "
            "suscripción. Las celdas de texto que podrían interpretarse como "
            "fórmula de hoja de cálculo se prefijan con un apóstrofo; los "
            "montos numéricos se mantienen numéricos.\n\n"
            "Ambos extremos son obligatorios y deben cumplir "
            "``desde <= hasta``. Filtros opcionales: ``moneda`` contra el "
            "catálogo activo y ``origen=manual`` (único origen registrado "
            "hoy; otros valores devuelven 400). También disponible como "
            "``GET /api/export/cobros/`` con los mismos parámetros."
        ),
        parameters=[
            OpenApiParameter(
                name="desde",
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description="Fecha inicial inclusiva (YYYY-MM-DD).",
                examples=[OpenApiExample("Marzo", value="2026-03-01")],
            ),
            OpenApiParameter(
                name="hasta",
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description="Fecha final inclusiva (YYYY-MM-DD).",
                examples=[OpenApiExample("Agosto", value="2026-08-31")],
            ),
            OpenApiParameter(
                name="moneda",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Código del catálogo activo de monedas (p. ej. CLP).",
            ),
            OpenApiParameter(
                name="origen",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Origen del cobro. Solo 'manual' está soportado.",
            ),
        ],
        responses={
            (200, "text/csv"): OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Archivo CSV con encabezados y una fila por cobro.",
                examples=[
                    OpenApiExample(
                        "CSV de ejemplo",
                        value=(
                            "servicio,categoria,monto,moneda,fecha,origen,estado\n"
                            "Netflix,streaming,12990.00,CLP,2026-03-05,manual,activo"
                        ),
                        response_only=True,
                    )
                ],
            ),
            400: OpenApiResponse(
                description=(
                    "Falta un extremo del rango, la fecha es inválida, "
                    "``desde > hasta``, la moneda no está en el catálogo "
                    "activo o el origen no está soportado."
                )
            ),
            403: OpenApiResponse(
                description="Falta la cabecera X-Organizacion-Id."
            ),
        },
    )
    @action(detail=False, methods=["get"], url_path="exportar-csv")
    def exportar_csv(self, request):
        """GET /api/suscripciones/exportar-csv/?desde=YYYY-MM-DD&hasta=YYYY-MM-DD."""
        desde, hasta, moneda, origen = _resolver_filtros_exportacion(request)
        return _respuesta_csv_cobros(request, desde, hasta, moneda, origen)

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


class ExportarCobrosCSVView(APIView):
    """Alias de la exportación CSV en ``/api/export/cobros/`` (VI-25).

    Reutiliza exactamente el mismo contrato, validación y constructor que la
    acción ``/api/suscripciones/exportar-csv/``. Existe porque la tarjeta
    admite cualquiera de las dos rutas y algunos clientes prefieren una ruta
    de exportación separada del recurso de suscripciones.
    """

    @extend_schema(
        summary="Exportar cobros a CSV (alias)",
        description=(
            "Misma operación que ``GET /api/suscripciones/exportar-csv/``. "
            "Rango inclusivo obligatorio, filtros opcionales ``moneda`` y "
            "``origen=manual``, y aislamiento por organización."
        ),
        parameters=[
            OpenApiParameter(
                name="desde",
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description="Fecha inicial inclusiva (YYYY-MM-DD).",
            ),
            OpenApiParameter(
                name="hasta",
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description="Fecha final inclusiva (YYYY-MM-DD).",
            ),
            OpenApiParameter(
                name="moneda",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Código del catálogo activo de monedas (p. ej. CLP).",
            ),
            OpenApiParameter(
                name="origen",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Origen del cobro. Solo 'manual' está soportado.",
            ),
        ],
        responses={
            (200, "text/csv"): OpenApiTypes.BINARY,
            400: OpenApiResponse(
                description=(
                    "Rango inválido, moneda fuera del catálogo activo u "
                    "origen no soportado."
                )
            ),
            403: OpenApiResponse(
                description="Falta la cabecera X-Organizacion-Id."
            ),
        },
    )
    def get(self, request):
        desde, hasta, moneda, origen = _resolver_filtros_exportacion(request)
        return _respuesta_csv_cobros(request, desde, hasta, moneda, origen)


class HallazgoPagination(PageNumberPagination):
    """Paginación de hallazgos: 10 por defecto, máximo 100."""

    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


@extend_schema_view(
    list=extend_schema(
        summary="Listar hallazgos de cobro",
        description=(
            "Alertas detectadas por VI-19 para la organización autenticada: "
            "``alza_tarifa`` (más de 5 % sobre el promedio de los 3 meses "
            "previos) y ``doble_cobro`` (otro cargo del mismo servicio a "
            "menos de 5 días).\n\n"
            "Filtros opcionales: ``estado``, ``tipo`` y ``suscripcion``. La "
            "respuesta está paginada con ``count``, ``next``, ``previous`` y "
            "``results``. Marcar una alerta como revisada no cambia el estado "
            "de la suscripción."
        ),
        parameters=[
            OpenApiParameter(
                name="estado",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                enum=[e.value for e in HallazgoCobro.Estado],
                description="Estado de revisión de la alerta.",
            ),
            OpenApiParameter(
                name="tipo",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                enum=[t.value for t in HallazgoCobro.Tipo],
                description="Tipo de anomalía.",
            ),
            OpenApiParameter(
                name="suscripcion",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
                description="UUID de la suscripción a la que pertenece el hallazgo.",
            ),
            OpenApiParameter(
                name="page",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Número de página, desde 1.",
            ),
            OpenApiParameter(
                name="page_size",
                type=int,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Tamaño de página (1 a 100; por defecto 10).",
            ),
        ],
        responses={
            200: OpenApiResponse(
                response=PaginatedHallazgoSerializer,
                description="Página de hallazgos.",
                examples=[
                    OpenApiExample(
                        "Alerta de alza",
                        value={
                            "count": 1,
                            "next": None,
                            "previous": None,
                            "results": [
                                {
                                    "id": "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
                                    "tipo": "alza_tarifa",
                                    "tipo_display": "Alza de tarifa",
                                    "suscripcion_id": "6f1c2a7e-8b4d-4c1a-9f2e-3a5b7c9d1e2f",
                                    "cobro_id": "0d6f7e8a-1b2c-4d3e-8f90-1a2b3c4d5e6f",
                                    "cobro_relacionado_id": None,
                                    "monto": "10600.00",
                                    "monto_referencia": "10000.00",
                                    "moneda": "CLP",
                                    "porcentaje_variacion": "6.00",
                                    "fecha_cobro": "2026-10-05",
                                    "fecha_referencia": None,
                                    "detalle": {
                                        "promedio": "10000.00",
                                        "umbral": "10500.00",
                                        "cantidad_previos": 2,
                                    },
                                    "estado": "pendiente",
                                    "estado_display": "Pendiente",
                                    "revisado_en": None,
                                    "revisado_por": None,
                                    "creado_en": "2026-10-05T09:15:00-03:00",
                                }
                            ],
                        },
                        response_only=True,
                    )
                ],
            ),
            400: OpenApiResponse(description="Filtro inválido."),
            403: OpenApiResponse(
                description="Falta la cabecera X-Organizacion-Id."
            ),
        },
    ),
)
class HallazgoCobroViewSet(PaginacionExplicitaMixin, SoloLecturaTenantViewSet):
    """Consulta y revisión de anomalías de cobro (VI-19 / RF-07)."""

    queryset = HallazgoCobro.objects.all()
    serializer_class = HallazgoCobroSerializer
    _pagination_class = HallazgoPagination

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action != "list":
            return qs

        estado = self.request.query_params.get("estado")
        if estado:
            if estado not in HallazgoCobro.Estado.values:
                raise ValidationError(
                    {
                        "estado": (
                            f"Estado no válido: '{estado}'. "
                            f"Opciones: {', '.join(HallazgoCobro.Estado.values)}."
                        )
                    }
                )
            qs = qs.filter(estado=estado)

        tipo = self.request.query_params.get("tipo")
        if tipo:
            if tipo not in HallazgoCobro.Tipo.values:
                raise ValidationError(
                    {
                        "tipo": (
                            f"Tipo no válido: '{tipo}'. "
                            f"Opciones: {', '.join(HallazgoCobro.Tipo.values)}."
                        )
                    }
                )
            qs = qs.filter(tipo=tipo)

        suscripcion_id = self.request.query_params.get("suscripcion")
        if suscripcion_id:
            try:
                uuid.UUID(str(suscripcion_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError(
                    {"suscripcion": "Debe ser un UUID válido."}
                ) from exc
            qs = qs.filter(suscripcion_id=suscripcion_id)

        return qs

    @extend_schema(
        summary="Marcar un hallazgo como revisado",
        description=(
            "Cambia ``estado`` de ``pendiente`` a ``revisada`` y registra "
            "``revisado_en``/``revisado_por``. Es idempotente y **no** "
            "modifica el estado de la suscripción ni borra el cobro."
        ),
        request=None,
        responses={200: HallazgoCobroSerializer},
    )
    @action(detail=True, methods=["post"], url_path="revisar")
    def revisar(self, request, pk=None):
        """POST /api/hallazgos/<id>/revisar/."""
        hallazgo = self.get_object()
        hallazgo = marcar_hallazgo_revisado(
            hallazgo,
            usuario_id=_actor_id_opcional(request),
        )
        return Response(
            HallazgoCobroSerializer(hallazgo).data,
            status=status.HTTP_200_OK,
        )

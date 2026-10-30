"""Vistas del servicio de notificaciones."""

import uuid

from django.conf import settings
from django.db import connection, transaction
from django.http import JsonResponse
from rest_framework import status
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.tenant.base import SoloLecturaTenantViewSet

from .models import Alerta, PreferenciaNotificacion, UsuarioEliminado
from shared.borrado.bloqueo import escritura_organizacion
from .serializers import (
    AlertaSerializer,
    ContadorSerializer,
    PreferenciaNotificacionSerializer,
)


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


class AlertaPagination(PageNumberPagination):
    """La misma paginación que el resto de los servicios."""

    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


class AlertaViewSet(SoloLecturaTenantViewSet):
    """
    Alertas de la organización (FE-19 / FE-20).

        GET  /api/alertas/                  lista, paginada
        GET  /api/alertas/<id>/             detalle
        GET  /api/alertas/contador/         lo que muestra la campana
        POST /api/alertas/<id>/leer/        marcar una como leída
        POST /api/alertas/<id>/revisar/     descartarla (RF-07)
        POST /api/alertas/leer-todas/       vaciar la campana de una

    Filtros del listado:
        ?lectura=pendiente        pendiente | leida | revisada
        ?tipo=alza_tarifa
        ?suscripcion_id=<uuid>

    Es `SoloLectura` para el CRUD, pero las acciones POST sí existen: una
    alerta no se *crea* ni se *edita* desde afuera —nace de un evento—, pero
    marcarla leída es un verbo del dominio. Eso es distinto de abrir un POST
    genérico que dejaría inventar alertas.
    """

    queryset = Alerta.objects.all()
    serializer_class = AlertaSerializer
    pagination_class = AlertaPagination

    def get_queryset(self):
        qs = super().get_queryset()

        # Solo el listado se filtra: get_queryset() también lo usan retrieve y
        # las acciones de detalle, y ahí un query param colgado haría
        # desaparecer el recurso con un 404.
        if self.action != "list":
            return qs

        lectura = self.request.query_params.get("lectura")
        if lectura:
            if lectura not in Alerta.Lectura.values:
                raise ValidationError(
                    {"lectura": f"Debe ser uno de: {', '.join(Alerta.Lectura.values)}."}
                )
            qs = qs.filter(lectura=lectura)

        tipo = self.request.query_params.get("tipo")
        if tipo:
            if tipo not in Alerta.Tipo.values:
                raise ValidationError(
                    {"tipo": f"Debe ser uno de: {', '.join(Alerta.Tipo.values)}."}
                )
            qs = qs.filter(tipo=tipo)

        suscripcion = self.request.query_params.get("suscripcion_id")
        if suscripcion:
            # Se valida acá y no al filtrar: Django levanta el error del UUID
            # recién al evaluar el queryset, que ocurre dentro del paginador.
            # Para entonces ya es tarde para responder 400 y sale un 500.
            try:
                uuid.UUID(str(suscripcion))
            except (ValueError, AttributeError, TypeError) as error:
                raise ValidationError(
                    {"suscripcion_id": "Debe ser un UUID válido."}
                ) from error
            qs = qs.filter(suscripcion_id=suscripcion)

        return qs

    # ── FE-20: el contador y las marcas de lectura ───────────────────

    def _del_tenant(self):
        """Las alertas de la organización, con la MISMA comprobación que el listado.

        Las acciones que no son `list` consultaban el ORM directo con
        `request.organizacion_id`. Si faltaba la cabecera, eso filtraba por
        `None`: cero filas, y la respuesta salía 200 diciendo "no tienes
        avisos". Una configuración rota se veía igual que una bandeja vacía.

        `MezclaTenant.get_queryset()` es quien levanta el 403, así que se
        reusa y después se le sacan los filtros del listado, que no aplican
        acá.
        """
        organizacion = getattr(self.request, "organizacion_id", None)
        if not organizacion:
            raise PermissionDenied("Falta el contexto de organización")
        return Alerta.objects.filter(organizacion_id=organizacion)

    @action(detail=False, methods=["get"], url_path="contador")
    def contador(self, request):
        """Lo que necesita la campana: cuántas sin ver, y cuántas hay."""
        base = self._del_tenant()
        datos = {
            "pendientes": base.filter(lectura=Alerta.Lectura.PENDIENTE).count(),
            "total": base.count(),
        }
        return Response(ContadorSerializer(datos).data)

    # PATCH además de POST: la tarjeta pide PATCH y los clientes que ya
    # existen usan POST. Aceptar los dos en la acción específica no habilita
    # el PATCH genérico del recurso, que sigue devolviendo 405.
    @action(detail=True, methods=["post", "patch"], url_path="leer")
    def leer(self, request, pk=None):
        alerta = self.get_object()
        alerta.marcar_leida()
        return Response(self.get_serializer(alerta).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post", "patch"], url_path="revisar")
    def revisar(self, request, pk=None):
        """Descarta la alerta sin tocar la suscripción (RF-07)."""
        alerta = self.get_object()
        alerta.marcar_revisada()
        return Response(self.get_serializer(alerta).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post", "patch"], url_path="leer-todas")
    def leer_todas(self, request):
        """Vacía la campana de una. Devuelve cuántas cambiaron."""
        pendientes = self._del_tenant().filter(lectura=Alerta.Lectura.PENDIENTE)
        # Se recorre en vez de un `update()` masivo para que cada alerta pase
        # por `marcar_leida` y quede con su `leida_en`. Un update() dejaría el
        # estado cambiado y la fecha en NULL, que es un dato a medias.
        cambiadas = 0
        for alerta in pendientes:
            alerta.marcar_leida()
            cambiadas += 1
        return Response({"leidas": cambiadas}, status=status.HTTP_200_OK)


@extend_schema_view(
    get=extend_schema(
        responses={200: PreferenciaNotificacionSerializer},
        summary="Leer las preferencias de notificación propias (FE-21)",
    ),
    patch=extend_schema(
        request=PreferenciaNotificacionSerializer,
        responses={200: PreferenciaNotificacionSerializer},
        summary="Cambiar algunas preferencias de notificación (FE-21)",
    ),
)
class PreferenciasNotificacionView(APIView):
    """
        GET   /api/preferencias-alertas/
        PATCH /api/preferencias-alertas/   { "por_push": true }

    Las preferencias **propias**: la llave es (organización, usuario) y las dos
    salen de las cabeceras del gateway, así que no hay forma de leer ni tocar
    las de otra persona. Por eso tampoco hay listado ni `<id>`: no hay nada que
    elegir.

    ── El GET crea los valores por omisión ─────────────────────────────────
    La primera vez que alguien pregunta, se crea su fila con los valores
    documentados en el modelo. La alternativa —devolver 404 hasta que alguien
    haga un POST— obligaría al frontend a manejar un caso que no le aporta
    nada: no existe el estado "esta persona no tiene preferencias", existe
    "todavía no las cambió".

    ── Solo PATCH, no PUT ──────────────────────────────────────────────────
    Un PUT exige mandar el objeto completo, y un cliente que mande de menos
    borraría sin querer lo que no conoce. Es justamente lo que el criterio
    "un PATCH inválido no sustituye preferencias válidas" quiere evitar, y con
    PATCH además la pantalla puede mandar un solo toggle.
    """

    def _mias(self, request) -> PreferenciaNotificacion:
        org = getattr(request, "organizacion_id", None)
        usuario = getattr(request, "usuario_id", None)
        if not org:
            raise PermissionDenied("Falta el contexto de organización")
        if not usuario:
            # Sin saber QUIÉN pregunta no se pueden entregar preferencias
            # personales. Devolver las de la organización sería mezclar a dos
            # personas en una misma fila.
            raise PermissionDenied("Falta el contexto de usuario")
        # GET también escribe los valores iniciales: participa del bloqueo.
        with escritura_organizacion(org):
            if UsuarioEliminado.objects.filter(organizacion_id=org, usuario_id=str(usuario)).exists():
                raise PermissionDenied("El usuario fue eliminado")
            preferencia, _ = PreferenciaNotificacion.objects.get_or_create(
                organizacion_id=org, usuario_id=str(usuario)
            )
        return preferencia

    def get(self, request):
        datos = PreferenciaNotificacionSerializer(self._mias(request)).data
        return Response(datos, status=status.HTTP_200_OK)

    def patch(self, request):
        preferencia = self._mias(request)
        entrada = PreferenciaNotificacionSerializer(
            preferencia, data=request.data, partial=True
        )
        # `raise_exception` hace que un cuerpo inválido salga como 400 ANTES
        # de tocar la fila: el criterio "un PATCH inválido no sustituye
        # preferencias válidas" se cumple porque no se guarda nada.
        entrada.is_valid(raise_exception=True)
        with transaction.atomic():
            entrada.save()
        return Response(entrada.data, status=status.HTTP_200_OK)

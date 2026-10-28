"""Vistas del servicio de conectores."""

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination

from shared.tenant.base import SoloLecturaTenantViewSet

from .models import CuentaConectada, Importacion
from .serializers import (
    CuentaConectadaSerializer,
    ImportacionSerializer,
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


def _usuario_de(request) -> str:
    """El usuario de la cabecera, o 403. La pone el gateway (ADR-004).

    Hace falta para el filtro `?mias=true`: sin saber quién pregunta no se
    puede saber cuáles son suyas, y devolver todas las de la organización
    sería contestar otra cosa.
    """
    usuario = getattr(request, "usuario_id", None)
    if not usuario:
        raise PermissionDenied("Falta el contexto de usuario")
    return str(usuario)


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
            # La regla vive en el modelo, no acá: `filtro_exigen_reautorizar()`
            # es la MISMA lista de estados que usa la propiedad. Tenerla escrita
            # dos veces fue el error anterior: el filtro solo miraba
            # REQUIERE_REAUTORIZACION, así que una cuenta en ERROR desaparecía
            # al pedir las que necesitan acción y aparecía al pedir las que no,
            # con su propio JSON diciendo `necesita_reautorizacion: true`.
            #
            # Queda una diferencia que el modelo documenta y no se puede cerrar
            # en SQL: una cuenta "conectada" cuyo token ya no descifra. Para esa
            # el camino es `marcar_para_reautorizar()`, que la deja en un estado
            # consultable.
            if reautorizar.lower() in ("true", "1"):
                qs = qs.filter(CuentaConectada.filtro_exigen_reautorizar())
            elif reautorizar.lower() in ("false", "0"):
                qs = qs.exclude(CuentaConectada.filtro_exigen_reautorizar())
            else:
                raise ValidationError(
                    {"necesita_reautorizacion": "Debe ser true o false."}
                )

        return qs


# ═══════════════════════════════════════════════════════════════════
# Importaciones (FE-08)
# ═══════════════════════════════════════════════════════════════════


class ImportacionViewSet(SoloLecturaTenantViewSet):
    """
        GET /api/importaciones/           las de la organización
        GET /api/importaciones/<id>/      una, para hacerle polling

    Solo lectura. Una importación no se crea con un POST suelto: nace del
    proceso que la ejecuta —FE-07 al recibir un CSV, FE-13 al leer correo— y
    su estado lo mueve ese proceso, no el cliente. Un `create` abierto acá
    permitiría inventar una importación "completada" sin que nada se hubiera
    procesado.

    ── El aislamiento ──────────────────────────────────────────────────────
    `MezclaTenant` filtra por la cabecera `X-Organizacion-Id` del gateway, así
    que una importación de otra organización ni se encuentra: responde 404 y
    no 403. Un 403 confirmaría que el id es de alguien. Es el criterio "no se
    consulta importación de otra organización".

    Filtros del listado:
        ?estado=procesando
        ?origen=csv
        ?mias=true        solo las que pidió quien consulta
    """

    queryset = Importacion.objects.all()
    serializer_class = ImportacionSerializer
    pagination_class = CuentaConectadaPagination

    def get_queryset(self):
        qs = super().get_queryset()
        # Solo el listado se filtra: `retrieve` también pasa por acá, y un
        # query param colgado haría desaparecer el recurso con un 404.
        if self.action != "list":
            return qs

        estado = self.request.query_params.get("estado")
        if estado:
            validos = Importacion.Estado.values
            if estado not in validos:
                raise ValidationError(
                    {"estado": f"Debe ser uno de: {', '.join(validos)}."}
                )
            qs = qs.filter(estado=estado)

        origen = self.request.query_params.get("origen")
        if origen:
            validos = Importacion.Origen.values
            if origen not in validos:
                raise ValidationError(
                    {"origen": f"Debe ser uno de: {', '.join(validos)}."}
                )
            qs = qs.filter(origen=origen)

        mias = self.request.query_params.get("mias")
        if mias is not None:
            if mias.lower() in ("true", "1"):
                # Sin cabecera de usuario no se puede saber cuáles son "mías".
                qs = qs.filter(usuario_id=_usuario_de(self.request))
            elif mias.lower() not in ("false", "0"):
                raise ValidationError({"mias": "Debe ser true o false."})

        return qs

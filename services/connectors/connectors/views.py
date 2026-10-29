"""Vistas del servicio de conectores."""

from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.bloqueo import bloquear
from shared.tenant.base import SoloLecturaTenantViewSet

from . import archivos
from .models import ArchivoImportacion, CuentaConectada, Importacion
from .serializers import (
    ArchivoRechazadoSerializer,
    CuentaConectadaSerializer,
    ImportacionSerializer,
    SubidaArchivoSerializer,
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


# ═══════════════════════════════════════════════════════════════════
# Subida de archivos para importar (FE-07)
# ═══════════════════════════════════════════════════════════════════


@extend_schema(
    request=SubidaArchivoSerializer,
    responses={
        201: ImportacionSerializer,
        400: ArchivoRechazadoSerializer,
        413: ArchivoRechazadoSerializer,
    },
    summary="Subir un CSV o una cartola PDF y crear la importación (FE-07)",
)
class SubirArchivoView(APIView):
    """
        POST /api/importaciones/archivos/      multipart, campo `archivo`
        → 201 con la importación en `pendiente`

    Recibe el archivo, lo valida ANTES de guardar nada (extensión, tamaño,
    contenido real: ver `archivos.py`), aplica la cuota diaria de la
    organización, guarda el archivo temporalmente y crea la importación.

    ── Lo que NO hace ───────────────────────────────────────────────────────
    No crea ni toca ninguna suscripción. Lo que devuelve es el `id` de una
    importación `pendiente`, que es el "job": FE-09 la toma, la procesa y
    deja candidatos; FE-11, recién con la confirmación de la persona, crea o
    actualiza suscripciones. Es el criterio "archivo válido devuelve id de
    importación y no crea suscripciones automáticamente".

    ── Códigos ──────────────────────────────────────────────────────────────
        400  falta el archivo, formato no admitido, vacío o contenido
             incompatible (con `codigo` estable)
        413  excede el tamaño máximo
        429  la organización agotó su cuota diaria
        403  sin contexto de organización o de usuario

    ── La cuota se cuenta con un lock ───────────────────────────────────────
    Contar y después crear deja una ventana en la que dos subidas simultáneas
    pasan las dos. El advisory lock por organización (`shared/bloqueo.py`)
    serializa el "contar + crear", igual que el agregado de analytics y el
    resumen de subscriptions.
    """

    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        organizacion_id = getattr(request, "organizacion_id", None)
        if not organizacion_id:
            raise PermissionDenied("Falta el contexto de organización")
        usuario_id = _usuario_de(request)

        subido = request.FILES.get("archivo")
        if subido is None:
            return Response(
                {"codigo": "falta_archivo", "archivo": "Falta el archivo: campo `archivo`, multipart."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tamano_maximo = int(settings.IMPORTACION_TAMANO_MAXIMO_BYTES)
        # Se lee a lo más un byte por sobre el máximo: un archivo enorme no
        # llega a cargarse entero en memoria antes de rechazarse.
        contenido = subido.read(tamano_maximo + 1)
        try:
            validado = archivos.validar(subido.name, contenido, tamano_maximo=tamano_maximo)
        except archivos.ArchivoRechazado as exc:
            codigo_http = (
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
                if exc.codigo == archivos.ARCHIVO_EXCEDIDO
                else status.HTTP_400_BAD_REQUEST
            )
            return Response({"codigo": exc.codigo, "archivo": exc.mensaje}, status=codigo_http)

        cuota = int(settings.IMPORTACION_CUOTA_DIARIA)
        retencion = timedelta(days=int(settings.IMPORTACION_DIAS_RETENCION))
        ahora = timezone.now()
        inicio_del_dia = timezone.make_aware(
            datetime.combine(timezone.localdate(ahora), time.min),
            timezone.get_current_timezone(),
        )

        with transaction.atomic():
            bloquear("cuota_importacion", organizacion_id)
            subidas_hoy = Importacion.objects.filter(
                organizacion_id=organizacion_id,
                origen=Importacion.Origen.CSV,
                creado_en__gte=inicio_del_dia,
            ).count()
            if subidas_hoy >= cuota:
                return Response(
                    {
                        "codigo": "cuota_excedida",
                        "detail": (
                            f"La organización ya subió {subidas_hoy} archivo(s) hoy; "
                            f"el máximo diario es {cuota}. Vuelve a intentar mañana."
                        ),
                    },
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            importacion = Importacion.objects.create(
                organizacion_id=organizacion_id,
                usuario_id=usuario_id,
                origen=Importacion.Origen.CSV,
                nombre_archivo=validado.nombre,
                filas_totales=validado.filas,
            )
            ArchivoImportacion.objects.create(
                organizacion_id=organizacion_id,
                importacion=importacion,
                formato=validado.formato,
                tamano=validado.tamano,
                sha256=validado.sha256,
                contenido=contenido,
                vence_en=ahora + retencion,
            )

        salida = ImportacionSerializer(importacion, context={"request": request})
        return Response(salida.data, status=status.HTTP_201_CREATED)

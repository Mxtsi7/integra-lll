"""Vistas del servicio de conectores."""

from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.bloqueo import bloquear
from shared.tenant.base import SoloLecturaTenantViewSet

from . import archivos, proveedores, revocacion
from .models import ArchivoImportacion, AutorizacionPendiente, CuentaConectada, Importacion
from .serializers import (
    ArchivoRechazadoSerializer,
    AutorizacionIniciadaSerializer,
    CallbackAutorizacionSerializer,
    CuentaConectadaSerializer,
    ImportacionSerializer,
    IniciarAutorizacionSerializer,
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


class CuentaConectadaViewSet(mixins.DestroyModelMixin, SoloLecturaTenantViewSet):
    """
    Cuentas de correo conectadas por la organización (FE-02 / RF-26).

        GET    /api/conectores/           lista
        GET    /api/conectores/<id>/      detalle
        DELETE /api/conectores/<id>/      desconectar y revocar (FE-05)

    Sin POST ni PUT a propósito. Una cuenta conectada no se crea con un POST
    suelto: nace del callback de OAuth (FE-04), que llega con un código del
    proveedor y hay que canjearlo. Dejar aquí un `create` abierto permitiría
    inventar una cuenta con tokens arbitrarios.

    El DELETE sí está: desconectar es algo que el dueño de la cuenta puede
    pedir cuando quiera. Ver `destroy` más abajo: no borra la fila.

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

    @extend_schema(
        responses={200: CuentaConectadaSerializer},
        summary="Desconectar una cuenta y revocar el acceso (FE-05)",
    )
    def destroy(self, request, *args, **kwargs):
        """Desconecta la cuenta: revoca en el proveedor y borra las credenciales.

        ── Por qué NO se borra la fila ─────────────────────────────────────
        Los cobros que ya se importaron apuntan a esta cuenta. Borrarla los
        dejaría huérfanos o se los llevaría por delante, y lo que el usuario
        pidió fue dejar de darnos acceso a su correo, no perder su historial.
        La tarjeta dice "revocar tokens, borrar credenciales, detener jobs y
        actualizar estado": nada de eso es borrar el registro.

        Los tokens solo se borran si el proveedor **confirmó** la
        revocación. Si no la confirmó, se conservan cifrados: son la
        única credencial con que reintentar, y borrarlos convierte la
        revocación en imposible, no en pendiente. La cuenta igual queda
        desconectada, así que no se lee más de ella.

        El detalle de cómo se decide está en `revocacion.py`.

        ── Qué significa "detener jobs" ────────────────────────────────────
        No hay un job corriendo que matar: la lectura de correo (FE-13) toma
        las cuentas en estado `conectada`. Al pasar a `desconectada` deja de
        entrar en esa selección, y es lo que cumple "desconectar impide
        nuevas lecturas". Queda un test que lo fija, para que si alguien
        cambia esa selección se entere acá.

        ── Por qué 200 y no 204 ────────────────────────────────────────────
        Devuelve la cuenta con su estado nuevo. Un 204 obligaría al frontend
        (AN-17) a pedir el listado de nuevo solo para saber cómo quedó. Es una
        desviación consciente del 204 que manda la convención para DELETE.

        El aislamiento entre organizaciones lo pone `get_queryset` de
        `MezclaTenant`: una cuenta de otra organización ni siquiera se
        encuentra, así que esto responde 404 y no 403. Es el criterio "otra
        organización no puede revocar ni consultar esa cuenta".
        """
        cuenta = self.get_object()
        revocacion.revocar_y_desconectar(cuenta)

        salida = self.get_serializer(cuenta)
        return Response(salida.data, status=status.HTTP_200_OK)


# ═══════════════════════════════════════════════════════════════════
# OAuth (FE-03 / FE-04)
# ═══════════════════════════════════════════════════════════════════


def _organizacion_de(request):
    """La organización de la cabecera, o 403. La pone el gateway (ADR-004)."""
    org = getattr(request, "organizacion_id", None)
    if not org:
        raise PermissionDenied("Falta el contexto de organización")
    return org




@extend_schema(
    request=IniciarAutorizacionSerializer,
    responses={200: AutorizacionIniciadaSerializer},
    summary="Iniciar la autorización de Gmail u Outlook (FE-03)",
)
class IniciarAutorizacionView(APIView):
    """
        POST /api/conectores/autorizaciones/
        { "proveedor": "gmail", "retorno": "https://..." }
        → { "url_autorizacion": "...", "estado_oauth": "...", "expira_en": "..." }

    No contacta al proveedor: arma el enlace y guarda el flujo. El HTTP con
    Google ocurre recién en el callback, cuando hay un código que canjear.

    Esto NO crea una cuenta conectada. Si el usuario cierra la pestaña o
    cancela, lo único que queda es una fila de `AutorizacionPendiente` que
    vence sola a los 10 minutos. Es el criterio "cancelar autorización no
    crea cuenta conectada", cumplido por construcción y no por un `if`.
    """

    def post(self, request):
        org = _organizacion_de(request)
        usuario = _usuario_de(request)
        entrada = IniciarAutorizacionSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)

        proveedor = entrada.validated_data["proveedor"]
        redirect_uri = settings.OAUTH_REDIRECT_URI
        if not redirect_uri:
            # Sin callback registrado el flujo no puede volver. Mejor decirlo
            # acá que mandar al usuario a una pantalla de error de Google.
            raise ValidationError(
                {"detalle": "OAUTH_REDIRECT_URI no está configurado en el servicio."}
            )

        autorizacion, desafio = AutorizacionPendiente.abrir(
            organizacion_id=org,
            usuario_id=usuario,
            sesion_id=getattr(request, "sesion_id", "") or "",
            proveedor=proveedor,
            redirect_uri=redirect_uri,
            retorno=entrada.validated_data.get("retorno", ""),
        )
        url = proveedores.url_de_autorizacion(
            proveedor,
            estado_oauth=autorizacion.estado_oauth,
            desafio_pkce=desafio,
            redirect_uri=redirect_uri,
        )
        salida = AutorizacionIniciadaSerializer(
            {
                "url_autorizacion": url,
                "estado_oauth": autorizacion.estado_oauth,
                "expira_en": autorizacion.expira_en,
            }
        )
        return Response(salida.data, status=status.HTTP_200_OK)


@extend_schema(
    request=CallbackAutorizacionSerializer,
    responses={200: CuentaConectadaSerializer},
    summary="Procesar el retorno de OAuth y guardar las credenciales (FE-04)",
)
class CallbackAutorizacionView(APIView):
    """
        POST /api/conectores/autorizaciones/callback/
        { "estado_oauth": "...", "codigo": "..." }            el usuario aceptó
        { "estado_oauth": "...", "error": "access_denied" }   canceló

    ── Quién puede cerrar un flujo ───────────────────────────────
    **Solo la misma persona que lo abrió.** Se exigen las dos cabeceras y las
    dos tienen que calzar con la fila de `AutorizacionPendiente`.

    Una versión anterior de este comentario decía que el callback llega "sin
    sesión ni cabecera que valga" porque es una redirección del navegador.
    **Eso era falso en este sistema**: `/api/conectores/` no está en
    `RUTAS_PUBLICAS`, así que el gateway exige JWT y la identidad SÍ llega. El
    frontend recibe el `code` y el `state` en la URL y los reenvía por POST
    con su token, que es como está cableado hoy.

    El `state` (43 caracteres de CSPRNG, de un solo uso) y PKCE prueban que el
    flujo es legítimo; **no** prueban que vuelva quien lo abrió. Sin el vínculo
    al usuario, cualquiera del mismo tenant podía cerrar el flujo de otro y
    quedarse con la cuenta conectada a su nombre. Lo reprodujo la revisión de
    la PR con dos usuarios del mismo tenant, y era cierto.

    Si algún día el callback se hace público (redirección directa del
    proveedor, sin pasar por el frontend), este vínculo hay que moverlo a una
    cookie efímera. Lo que NO corresponde es abrir todo el prefijo de
    conectores para resolverlo.

    ── Por qué el state se quema ANTES de canjear ──────────────────────────
    Si se canjeara primero, dos callbacks simultáneos con el mismo código
    entrarían los dos al canje antes de que ninguno marcara la fila. Quemando
    primero, el UPDATE condicional deja pasar a uno solo. Que un canje
    fallido deje el flujo quemado es correcto: el código de OAuth también es
    de un solo uso del lado del proveedor, así que reintentarlo fallaría
    igual. Hay que empezar de nuevo, y eso es lo honesto.
    """

    def post(self, request):
        entrada = CallbackAutorizacionSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data

        autorizacion = AutorizacionPendiente.objects.filter(
            estado_oauth=datos["estado_oauth"]
        ).first()
        if autorizacion is None:
            # Mismo mensaje para "no existe" y "ya no sirve": distinguirlos le
            # diría a quien prueba states al azar cuándo acertó uno.
            raise ValidationError({"estado_oauth": "El flujo no es válido o ya venció."})

        # Las dos son obligatorias. Antes la organización se comprobaba solo
        # "si venía", o sea que no comprobaba nada: una petición sin cabeceras
        # pasaba derecho.
        if str(_organizacion_de(request)) != str(autorizacion.organizacion_id):
            raise PermissionDenied("El flujo pertenece a otra organización.")
        if _usuario_de(request) != autorizacion.usuario_id:
            # Mismo tenant, otra persona. No se dice de quién es el flujo.
            raise PermissionDenied("El flujo lo inició otro usuario.")
        # Y la misma SESIÓN: dos pestañas del mismo usuario son dos flujos.
        # Si el flujo se abrió sin `sid` (token viejo) no se compara, para
        # no romper los que estaban en vuelo al desplegar esto.
        if autorizacion.sesion_id:
            if (getattr(request, "sesion_id", "") or "") != autorizacion.sesion_id:
                raise PermissionDenied("El flujo lo inició otra sesión.")

        if not autorizacion.vigente:
            raise ValidationError({"estado_oauth": "El flujo no es válido o ya venció."})

        # Un solo uso. Lo primero, antes de hablar con el proveedor.
        if not autorizacion.marcar_usada():
            raise ValidationError({"estado_oauth": "El flujo no es válido o ya venció."})

        # El usuario canceló: no se crea nada. Criterio de FE-03.
        if datos.get("error"):
            return Response(
                {
                    "resultado": "cancelada",
                    "proveedor": autorizacion.proveedor,
                    "detalle": datos["error"][:120],
                    "retorno": autorizacion.retorno,
                },
                status=status.HTTP_200_OK,
            )

        try:
            respuesta = proveedores.canjear_codigo(
                autorizacion.proveedor,
                codigo=datos["codigo"],
                verificador_pkce=str(autorizacion.verificador_pkce),
                redirect_uri=autorizacion.redirect_uri,
            )
            correo = proveedores.correo_autorizado(
                autorizacion.proveedor, respuesta
            )
        except proveedores.ErrorDelProveedor as exc:
            # Cubre el canje Y la validación de los claims del id_token:
            # las dos cosas son "el proveedor no entregó algo que sirva",
            # y las dos tienen que salir como 400 y no como 500.
            # El mensaje está construido para no llevar tokens (ver
            # proveedores.py). Igual se acota.
            raise ValidationError({"detalle": str(exc)[:200]}) from exc

        if not correo:
            raise ValidationError(
                {"detalle": "El proveedor no identificó qué cuenta se autorizó."}
            )

        vence = None
        segundos = respuesta.get("expires_in")
        if isinstance(segundos, (int, float)) and segundos > 0:
            vence = timezone.now() + timedelta(seconds=int(segundos))

        defaults = {
            "access_token": respuesta["access_token"],
            "token_expira_en": vence,
            "estado": CuentaConectada.Estado.CONECTADA,
            "detalle_del_estado": "",
        }
        # Si el proveedor no manda refresh token (Google solo lo entrega con
        # prompt=consent), se conserva el que hubiera: pisarlo con vacío
        # dejaría la cuenta sin poder refrescarse y nadie se enteraría hasta
        # que venciera el de acceso.
        if respuesta.get("refresh_token"):
            defaults["refresh_token"] = respuesta["refresh_token"]

        with transaction.atomic():
            cuenta, _ = CuentaConectada.objects.update_or_create(
                organizacion_id=autorizacion.organizacion_id,
                proveedor=autorizacion.proveedor,
                cuenta_externa=correo,
                defaults=defaults,
            )
            # Credenciales nuevas: sube la versión y BORRA `revocado_en`.
            # Sin esto, una cuenta revocada y reconectada conservaba la
            # fecha de la revocación vieja, quedaba fuera de
            # `pendientes_de_revocar()` y la limpieza de #72 habría tomado
            # esa fecha como prueba de que las NUEVAS estaban revocadas.
            revocacion.registrar_credenciales_nuevas(cuenta)

        salida = CuentaConectadaSerializer(cuenta, context={"request": request})
        return Response(salida.data, status=status.HTTP_200_OK)


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

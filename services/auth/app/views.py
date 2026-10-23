from django.contrib.auth import authenticate
from django.db import transaction
from redis.exceptions import RedisError
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
import uuid

from .models import Organizacion, User
from .eliminacion import EliminarCuentaMixin
from .recuperacion import ErrorTokenRecuperacion, confirmar_recuperacion, solicitar_recuperacion
from shared.sesiones import registrar_credenciales
from .sesiones import emitir_tokens
from .contexto import usuario_del_contexto
from .perfil import CambioPerfilSerializer
from .serializers import (
    LoginSerializer,
    RegisterSerializer,
    SolicitudRecuperacionSerializer,
    ConfirmacionRecuperacionSerializer,
    ErrorRecuperacionSerializer,
    ErrorPasswordRecuperacionSerializer,
    UserSerializer,
    UsuarioActualSerializer,
    MiembroSerializer,
    OrganizacionDetalleSerializer,  # nuevo
)

from drf_spectacular.utils import OpenApiExample, OpenApiParameter, OpenApiResponse, PolymorphicProxySerializer, extend_schema
from drf_spectacular.types import OpenApiTypes


class RegisterView(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        tags=["Auth"],
        summary="Registrar usuario",
        description=(
            "Crea un usuario y su organización (titular) o lo une a una "
            "organización existente con `codigo_organizacion` (integrante). "
            "Ruta pública."
        ),
        request=RegisterSerializer,
        responses={
            201: OpenApiResponse(
                response=UserSerializer,
                description="Usuario creado (sin password).",
            ),
            400: OpenApiResponse(description="Validación fallida (email, password, consentimiento, etc.)."),
        },
        examples=[
            OpenApiExample(
                "Registro titular (nueva organización)",
                value={
                    "email": "ana@ejemplo.com",
                    "nombre": "Ana",
                    "password": "ClaveSegura123",
                    "acepta_datos": True,
                },
                request_only=True,
            ),
            OpenApiExample(
                "Registro integrante (código de organización)",
                value={
                    "email": "pedro@ejemplo.com",
                    "nombre": "Pedro",
                    "password": "ClaveSegura123",
                    "acepta_datos": True,
                    "codigo_organizacion": "9c2140a0-0000-0000-0000-000000000001",
                },
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.save()
        return Response(
            UserSerializer(user).data,
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """POST /api/auth/login/ — pública (RUTAS_PUBLICAS del gateway).

    Autentica por correo/contraseña y firma los tokens con JWT_SECRET, el
    mismo que el gateway usa para validarlos (ADR-004).
    """

    authentication_classes = []
    permission_classes = []

    MENSAJE_GENERICO = "Correo o contraseña inválidos"

    @extend_schema(
        tags=["Auth"],
        summary="Iniciar sesión",
        description=(
            "Autentica con email y password. Devuelve access_token, refresh_token "
            "y datos básicos del usuario. El JWT incluye claims organizacion_id y rol "
            "(ADR-004). Ruta pública."
        ),
        request=LoginSerializer,
        responses={
            200: OpenApiResponse(
                description="Login correcto.",
                examples=[
                    OpenApiExample(
                        "Respuesta exitosa",
                        value={
                            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                            "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                            "usuario": {
                                "id": 1,
                                "nombre": "Ana",
                                "correo": "ana@ejemplo.com",
                            },
                        },
                    )
                ],
            ),
            401: OpenApiResponse(
                description="Credenciales inválidas (mismo mensaje si el correo no existe o la clave falla).",
                examples=[
                    OpenApiExample(
                        "Error genérico",
                        value={"detail": "Correo o contraseña inválidos"},
                    )
                ],
            ),
            400: OpenApiResponse(description="Body inválido (email mal formado, campos faltantes)."),
        },
        examples=[
            OpenApiExample(
                "Credenciales de ejemplo",
                value={"email": "demo@ojoalgasto.cl", "password": "Demo-2026-ojo"},
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Bloquear antes de authenticate: Django puede actualizar un hash
        # antiguo al comprobar la contraseña. No debe pisar un reset paralelo.
        with transaction.atomic():
            bloqueado = User.objects.select_for_update().filter(
                email__iexact=serializer.validated_data["email"],
            ).first()
            user = authenticate(
                request,
                email=serializer.validated_data["email"],
                password=serializer.validated_data["password"],
            )
            if user is None or bloqueado is None or user.pk != bloqueado.pk:
                return Response(
                    {"detail": self.MENSAJE_GENERICO},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            try:
                version = registrar_credenciales(user)
                tokens = emitir_tokens(user, version=version)
            except (RedisError, OSError):
                transaction.set_rollback(True)
                return Response(
                    {"detail": "No se pudo iniciar sesión. Inténtalo nuevamente."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        return Response(
            {
                **tokens,
                "usuario": {
                    "id": user.id,
                    "nombre": user.nombre,
                    "correo": user.email,
                },
            },
            status=status.HTTP_200_OK,
        )


class SolicitudRecuperacionView(APIView):
    """POST /api/auth/password-reset/ — pública (RUTAS_PUBLICAS del gateway).

    Responde siempre igual, exista o no el correo, para no permitir
    enumerar cuentas.
    """

    authentication_classes = []
    permission_classes = []

    MENSAJE_NEUTRO = (
        "Si el correo está registrado, recibirás un enlace para "
        "restablecer tu contraseña."
    )

    @extend_schema(
        tags=["Auth"],
        summary="Solicitar recuperación de contraseña",
        description=(
            "Envía un enlace de un solo uso, válido por 60 minutos. La respuesta "
            "es idéntica exista o no el correo (anti-enumeración). Ruta pública."
        ),
        request=SolicitudRecuperacionSerializer,
        responses={
            200: OpenApiResponse(
                description="Solicitud recibida (respuesta neutra).",
                examples=[
                    OpenApiExample(
                        "Respuesta neutra",
                        value={"detail": MENSAJE_NEUTRO},
                    )
                ],
            ),
            400: OpenApiResponse(description="Email ausente o mal formado."),
        },
        examples=[
            OpenApiExample(
                "Solicitud",
                value={"email": "ana@ejemplo.com"},
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = SolicitudRecuperacionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        solicitar_recuperacion(serializer.validated_data["email"])

        return Response(
            {"detail": self.MENSAJE_NEUTRO},
            status=status.HTTP_200_OK,
        )


class ConfirmacionRecuperacionView(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        tags=["Auth"],
        summary="Confirmar recuperación de contraseña",
        description=(
            "Recibe el token compuesto del enlace y password. Aplica RF-01.1, "
            "consume el enlace de forma atómica y revoca las sesiones anteriores. "
            "No inicia sesión automáticamente."
        ),
        request=ConfirmacionRecuperacionSerializer,
        responses={
            200: OpenApiResponse(description="Contraseña restablecida. Inicia sesión nuevamente."),
            400: OpenApiResponse(
                response=PolymorphicProxySerializer(
                    component_name="ErrorConfirmacionRecuperacion",
                    serializers=[ErrorRecuperacionSerializer, ErrorPasswordRecuperacionSerializer],
                    resource_type_field_name=None,
                ),
                description="Token inválido: code=token_invalido. Contraseña inválida: errores por campo password.",
                examples=[OpenApiExample(
                    "Enlace inválido", value=ErrorTokenRecuperacion("token_invalido").respuesta,
                )],
            ),
            410: OpenApiResponse(
                response=ErrorRecuperacionSerializer,
                description="Enlace vencido (token_expirado) o consumido (token_usado). Solicitar otro enlace mediante POST.",
                examples=[
                    OpenApiExample("Enlace vencido", value=ErrorTokenRecuperacion("token_expirado").respuesta),
                    OpenApiExample("Enlace utilizado", value=ErrorTokenRecuperacion("token_usado").respuesta),
                ],
            ),
            503: OpenApiResponse(description="No se pudo revocar sesiones; contraseña sin cambios."),
        },
    )
    def post(self, request):
        serializer = ConfirmacionRecuperacionSerializer(data=request.data)
        if not serializer.is_valid():
            if "token" in serializer.errors:
                error = ErrorTokenRecuperacion("token_invalido")
                return Response(error.respuesta, status=error.estado_http)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            confirmar_recuperacion(
                serializer.validated_data["token"], serializer.validated_data["password"],
            )
        except ErrorTokenRecuperacion as error:
            return Response(error.respuesta, status=error.estado_http)
        except (RedisError, OSError):
            return Response(
                {"detail": "No se pudo restablecer la contraseña. Inténtalo nuevamente."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response({"detail": "Contraseña restablecida. Inicia sesión nuevamente."})


class UsuarioActualView(EliminarCuentaMixin, generics.RetrieveAPIView):
    """GET /api/usuarios/me/ — el usuario del token. Es la que llama la web."""

    serializer_class = UsuarioActualSerializer
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        tags=["Usuarios"],
        summary="Usuario actual (me)",
        description=(
            "Devuelve el usuario activo identificado por X-Usuario-Id y valida "
            "X-Organizacion-Id contra su pertenencia vigente. El gateway inyecta "
            "ambas cabeceras tras validar el JWT. Una organización desactualizada "
            "devuelve 403; el cliente debe descartar la sesión y volver a iniciar sesión."
        ),
        responses={
            200: UsuarioActualSerializer,
            403: OpenApiResponse(description=(
                "Contexto de usuario ausente/inválido o la organización de la sesión "
                "no coincide con la pertenencia vigente."
            )),
            404: OpenApiResponse(description="El usuario del token no existe o está inactivo."),
        },
    )
    def get(self, request, *args, **kwargs):
        respuesta = super().get(request, *args, **kwargs)
        respuesta["Cache-Control"] = "no-store"
        return respuesta

    def get_object(self):
        return usuario_del_contexto(self.request)

    @extend_schema(tags=["Usuarios"], request=CambioPerfilSerializer,
                   responses={200: UsuarioActualSerializer, 400: None, 403: None, 404: None})
    def patch(self, request):
        datos = CambioPerfilSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        with transaction.atomic():
            usuario = usuario_del_contexto(request, bloquear=True)
            usuario.nombre = datos.validated_data["nombre"]
            usuario.save(update_fields=["nombre"])
        return Response(UsuarioActualSerializer(usuario).data)


class UserDetailView(generics.RetrieveAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        tags=["Usuarios"],
        summary="Detalle de usuario por id",
        description=(
            "Devuelve el usuario con el id de la URL, solo si coincide con "
            "X-Usuario-Id (contexto del gateway). Sin password."
        ),
        responses={
            200: UserSerializer,
            403: OpenApiResponse(description="Falta la cabecera X-Usuario-Id."),
            404: OpenApiResponse(description="El usuario no existe, o el id pedido no es el del token."),
        },
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        usuario = usuario_del_contexto(self.request)
        return User.objects.filter(pk=usuario.pk)



class OrganizacionView(APIView):
    """GET /api/organizacion/ — detalle de la organización del usuario autenticado.

    El gateway valida el JWT e inyecta X-Usuario-Id, X-Organizacion-Id y X-Rol.
    Este servicio confía en esas cabeceras (ADR-004) y NO revalida el token.
    """

    authentication_classes = []
    permission_classes = []

    @extend_schema(
        tags=["Organización"],
        summary="Detalle de la organización actual",
        description=(
            "Devuelve la organización del contexto (X-Organizacion-Id), "
            "sus miembros activos y el rol del usuario que consulta (mi_rol). "
            "Requiere las cabeceras que inyecta el gateway tras validar el JWT (ADR-004)."
        ),
        parameters=[
            OpenApiParameter(
                name="X-Usuario-Id",
                type=OpenApiTypes.STR,
                location=OpenApiParameter.HEADER,
                required=True,
                description="Id del usuario autenticado (inyectado por el gateway).",
            ),
            OpenApiParameter(
                name="X-Organizacion-Id",
                type=OpenApiTypes.UUID,
                location=OpenApiParameter.HEADER,
                required=True,
                description="UUID de la organización del token (inyectado por el gateway).",
            ),
            OpenApiParameter(
                name="X-Rol",
                type=OpenApiTypes.STR,
                location=OpenApiParameter.HEADER,
                required=False,
                description="Rol en el JWT (informativo; la vista lee el rol real desde BD).",
            ),
        ],
        responses={
            200: OpenApiResponse(
                response=OrganizacionDetalleSerializer,
                description="Organización, miembros activos y mi_rol.",
                examples=[
                    OpenApiExample(
                        "Ejemplo de hogar",
                        value={
                            "id": "9c2140a0-0000-0000-0000-000000000001",
                            "nombre": "Hogar de Ana",
                            "miembros": [
                                {
                                    "id": 1,
                                    "nombre": "Ana",
                                    "correo": "ana@ejemplo.com",
                                    "rol": "titular",
                                },
                                {
                                    "id": 2,
                                    "nombre": "Pedro",
                                    "correo": "pedro@ejemplo.com",
                                    "rol": "integrante",
                                },
                            ],
                            "mi_rol": "titular",
                        },
                    )
                ],
            ),
            403: OpenApiResponse(
                description=(
                    "Falta X-Usuario-Id o X-Organizacion-Id, UUID inválido, "
                    "o el usuario no pertenece a esa organización."
                ),
            ),
            404: OpenApiResponse(description="La organización no existe."),
        },
    )

    def get(self, request):
        # Leer identidad inyectada por el gateway (ADR-004).
        usuario_id = request.headers.get("X-Usuario-Id")
        organizacion_id = request.headers.get("X-Organizacion-Id")

        # Validación de contexto mínimo: ambas cabeceras son obligatorias.
        if not usuario_id:
            raise PermissionDenied("Falta el contexto de usuario (X-Usuario-Id)")
        if not organizacion_id:
            raise PermissionDenied("Falta el contexto de organización (X-Organizacion-Id)")

        # Validar que X-Organizacion-Id es un UUID válido (evita 500 por UUID inválido).
        try:
            uuid.UUID(organizacion_id)
        except ValueError:
            raise PermissionDenied("Identificador de organización inválido")

        # Cargar organización y verificar que existe.
        organizacion = get_object_or_404(Organizacion, pk=organizacion_id)

        # Verificar que el usuario pertenece a esta organización Y está activo.
        # El gateway ya garantiza la pertenencia, pero validamos aquí por defensa en profundidad.
        if not User.objects.filter(
            pk=usuario_id,
            organizacion_id=organizacion_id,
            is_active=True,
        ).exists():
            raise PermissionDenied("El usuario no pertenece a la organización indicada")

        # Obtener miembros ACTIVOS de la organización.
        miembros_qs = User.objects.filter(
            organizacion_id=organizacion_id,
            is_active=True,
        )

        # Determinar mi_rol: leer el rol real del usuario en BD.
        # X-Rol puede quedar desactualizado si el rol cambió; la BD es la fuente de verdad.
        usuario = User.objects.filter(pk=usuario_id).only("rol").first()
        mi_rol = usuario.rol if usuario and usuario.rol else "integrante"

        # Serializar respuesta: MiembroSerializer ya incluye "correo" (source="email").
        return Response(
            {
                "id": str(organizacion.id),
                "nombre": organizacion.nombre,
                "miembros": MiembroSerializer(miembros_qs, many=True).data,
                "mi_rol": mi_rol,
            },
            status=status.HTTP_200_OK,
        )



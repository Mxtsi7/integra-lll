from django.contrib.auth import authenticate
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
import uuid

from .models import Organizacion, User
from .serializers import (
    LoginSerializer,
    RegisterSerializer,
    UserSerializer,
    UsuarioActualSerializer,
    MiembroSerializer,
    OrganizacionDetalleSerializer,  # nuevo
)

from drf_spectacular.utils import OpenApiExample, OpenApiParameter, OpenApiResponse, extend_schema
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

        user = authenticate(
            request,
            email=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            return Response(
                {"detail": self.MENSAJE_GENERICO},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        refresh = RefreshToken.for_user(user)

        refresh["organizacion_id"] = (
            str(user.organizacion_id) if user.organizacion_id else None
        )
        refresh["rol"] = user.rol

        access = refresh.access_token
        access["organizacion_id"] = refresh["organizacion_id"]
        access["rol"] = user.rol

        return Response(
            {
                "access_token": str(access),
                "refresh_token": str(refresh),
                "usuario": {
                    "id": user.id,
                    "nombre": user.nombre,
                    "correo": user.email,
                },
            },
            status=status.HTTP_200_OK,
        )


class UsuarioActualView(generics.RetrieveAPIView):
    """GET /api/usuarios/me/ — el usuario del token. Es la que llama la web."""

    serializer_class = UsuarioActualSerializer
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        tags=["Usuarios"],
        summary="Usuario actual (me)",
        description=(
            "Devuelve el usuario identificado por la cabecera X-Usuario-Id "
            "(la pone el gateway tras validar el JWT). Es la ruta que consume el frontend."
        ),
        responses={
            200: UsuarioActualSerializer,
            403: OpenApiResponse(description="Falta X-Usuario-Id."),
            404: OpenApiResponse(description="Usuario no encontrado."),
        },
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_object(self):
        usuario_id = self.request.headers.get("X-Usuario-Id")
        if not usuario_id:
            raise PermissionDenied("Falta el contexto de usuario")
        return get_object_or_404(User, pk=usuario_id)


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
            403: OpenApiResponse(description="Falta X-Usuario-Id o no coincide con el id solicitado."),
            404: OpenApiResponse(description="Usuario no encontrado."),
        },
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        usuario_id = self.request.headers.get("X-Usuario-Id")
        if not usuario_id:
            raise PermissionDenied("Falta el contexto de usuario")
        return User.objects.filter(pk=usuario_id)



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


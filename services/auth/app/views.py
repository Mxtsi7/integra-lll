from django.contrib.auth import authenticate
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .serializers import (
    LoginSerializer,
    RegisterSerializer,
    UserSerializer,
    UsuarioActualSerializer,
)


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
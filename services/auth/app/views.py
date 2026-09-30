from django.contrib.auth import authenticate
from django.shortcuts import get_object_or_404
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
)


class RegisterView(APIView):
    authentication_classes = []
    permission_classes = []

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


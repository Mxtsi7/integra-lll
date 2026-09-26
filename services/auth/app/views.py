from django.contrib.auth import authenticate
from django.shortcuts import get_object_or_404
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
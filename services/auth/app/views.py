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



class OrganizacionView(APIView):
    """GET /api/organizacion/ o /organizacion/ -- detalles de la organizacion del usuario autenticado.

    Requiere JWT valido en la cabecera Authorization: Bearer <token>.
    El gateway ya inyecta las cabeceras X-Usuario-Id, X-Organizacion-Id y X-Rol
    tras validar el token, pero tambien v�lido directamente aqu� para acceso
    al servicio auth.
    """

    authentication_classes = []
    permission_classes = []

    def get(self, request):
        # Primero intentar usar las cabeceras inyectadas por el gateway
        # (RF-26: el gateway valida el JWT y coloca la identidad en cabeceras,
        # los servicios internos confian en estas cabeceras y no vuelven a validar).
        usuario_id = request.headers.get("X-Usuario-Id")
        organizacion_id = request.headers.get("X-Organizacion-Id")
        rol = request.headers.get("X-Rol")

        # Si no vienen las cabeceras del gateway (llamada directa al servicio auth),
        # validar el JWT manualmente para extraer la identidad.
        if not usuario_id:
            auth_header = request.headers.get("Authorization", "")
            token = None

            if auth_header.startswith("Bearer "):
                token = auth_header[len("Bearer "):].strip()

            if not token:
                raise PermissionDenied("Falta el token: se espera 'Authorization: Bearer <token>'")

            # Validar JWT usando la misma l�gica que el gateway
            import jwt
            from django.conf import settings

            try:
                claims = jwt.decode(
                    token,
                    settings.JWT_SECRET,
                    algorithms=[settings.JWT_ALGORITMO],
                    options={"require": ["exp"]},
                )
            except jwt.ExpiredSignatureError:
                resp = Response(
                    {"detail": "El token expiro"},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
                resp["WWW-Authenticate"] = "Bearer"
                return resp
            except jwt.InvalidTokenError:
                resp = Response(
                    {"detail": "Token invalido"},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
                resp["WWW-Authenticate"] = "Bearer"
                return resp

            usuario_id = claims.get("sub") or claims.get("user_id")
            organizacion_id = claims.get("organizacion_id")
            rol = claims.get("rol")

        if not usuario_id or not organizacion_id:
            raise PermissionDenied("El token no identifica al usuario o a la organizacion")

        from django.shortcuts import get_object_or_404
        from .models import Organizacion, User

        organizacion = get_object_or_404(Organizacion, pk=organizacion_id)

        # Obtener todos los miembros ACTIVOS de la organizacion
        miembros = User.objects.filter(
            organizacion_id=organizacion_id,
            is_active=True,
        ).values(
            "id", "nombre", "email", "rol"
        )

        mi_rol = rol if rol else "integrante"

        return Response(
            {
                "id": str(organizacion.id),
                "nombre": organizacion.nombre,
                "miembros": list(miembros),
                "mi_rol": mi_rol,
            },
            status=status.HTTP_200_OK,
        )


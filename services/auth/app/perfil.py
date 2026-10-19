from django.db import transaction
from redis.exceptions import RedisError
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from shared.sesiones import registrar_credenciales
from .contexto import usuario_del_contexto
from .passwords import validar_password


class CambioPerfilSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=150)

    def validate(self, datos):
        if set(self.initial_data) != {"nombre"}:
            raise serializers.ValidationError("Solo se permite actualizar nombre.")
        return datos


class CambioClaveSerializer(serializers.Serializer):
    password_actual = serializers.CharField(write_only=True, trim_whitespace=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False, validators=[validar_password])
    password_confirmacion = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, datos):
        if datos["password"] != datos["password_confirmacion"]:
            raise serializers.ValidationError({"password_confirmacion": "Las contraseñas no coinciden."})
        return datos


class CambioClaveView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Auth"], request=CambioClaveSerializer,
                   responses={200: None, 400: None, 403: None, 404: None, 503: None})
    def post(self, request):
        datos = CambioClaveSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                usuario = usuario_del_contexto(request, bloquear=True)
                if not usuario.check_password(datos.validated_data["password_actual"]):
                    return Response({"password_actual": ["La contraseña actual no es válida."]}, status=400)
                usuario.set_password(datos.validated_data["password"])
                registrar_credenciales(usuario)
                usuario.save(update_fields=["password"])
        except (RedisError, OSError):
            return Response({"detail": "No se pudo cambiar la contraseña. Inténtalo nuevamente."}, status=503)
        return Response({"detail": "Contraseña actualizada. Inicia sesión nuevamente."})

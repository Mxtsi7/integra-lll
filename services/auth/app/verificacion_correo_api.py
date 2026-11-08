from smtplib import SMTPException

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .contratos_auth import MensajeAuthSerializer
from .verificacion_correo import ErrorVerificacionCorreo, confirmar_verificacion, solicitar_verificacion


class SolicitudVerificacionSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, max_length=254)
    password = serializers.CharField(required=False, write_only=True, trim_whitespace=False)


class ConfirmacionVerificacionSerializer(serializers.Serializer):
    token = serializers.CharField(write_only=True, max_length=128)


class VerificacionCorreoView(APIView):
    authentication_classes = []
    permission_classes = []

    def ejecutar(self, accion, *args):
        try:
            accion(*args)
        except ErrorVerificacionCorreo as error:
            return Response(error.respuesta, status=error.estado_http)
        except (OSError, SMTPException):
            return Response({"detail": "No se pudo enviar el correo. Inténtalo nuevamente."}, status=503)
        return Response({"detail": self.mensaje})


class SolicitudVerificacionView(VerificacionCorreoView):
    mensaje = "Se envió el enlace de verificación."

    @extend_schema(
        tags=["Auth"], summary="Solicitar o reenviar verificación de correo",
        description="Requiere JWT validado por gateway. Email opcional; cambiarlo requiere password actual. Conserva el correo activo hasta confirmar. Máximo 5 envíos/hora y uno cada 60 segundos.",
        request=SolicitudVerificacionSerializer,
        responses={200: OpenApiResponse(response=MensajeAuthSerializer, description="Enlace enviado."), 400: OpenApiResponse(description="Datos o identidad inválidos."), 403: OpenApiResponse(description="Falta identidad del gateway."), 404: OpenApiResponse(description="Usuario no activo o inexistente."), 429: OpenApiResponse(description="Límite de reenvío."), 503: OpenApiResponse(description="Fallo de correo; solicitud revertida.")},
    )
    def post(self, request):
        serializer = SolicitudVerificacionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.ejecutar(solicitar_verificacion, request.headers.get("X-Usuario-Id"), serializer.validated_data.get("email"), serializer.validated_data.get("password"))


class ConfirmacionVerificacionView(VerificacionCorreoView):
    mensaje = "Correo verificado."

    @extend_schema(
        tags=["Auth"], summary="Confirmar verificación de correo",
        description="Ruta pública. Token de un solo uso, válido 60 minutos. Activa exclusivamente el correo y usuario asociados al token y avisa al correo anterior si hubo cambio.",
        request=ConfirmacionVerificacionSerializer,
        responses={200: OpenApiResponse(response=MensajeAuthSerializer, description="Correo verificado."), 400: OpenApiResponse(description="Token inválido, revocado o correo ocupado."), 410: OpenApiResponse(description="Token expirado o usado."), 503: OpenApiResponse(description="Fallo del aviso; cambio revertido y token reutilizable.")},
    )
    def post(self, request):
        serializer = ConfirmacionVerificacionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.ejecutar(confirmar_verificacion, serializer.validated_data["token"])

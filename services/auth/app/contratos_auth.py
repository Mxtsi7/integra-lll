"""Serializers de salida: documentan el JSON real sin cambiar las vistas."""
from rest_framework import serializers


class MensajeAuthSerializer(serializers.Serializer):
    detail = serializers.CharField()


class UsuarioLoginSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    nombre = serializers.CharField()
    correo = serializers.EmailField()


class LoginRespuestaSerializer(serializers.Serializer):
    access_token = serializers.CharField()
    refresh_token = serializers.CharField()
    usuario = UsuarioLoginSerializer()


class EliminacionAceptadaSerializer(serializers.Serializer):
    operacion_id = serializers.UUIDField()
    estado = serializers.ChoiceField(choices=["pendiente"])

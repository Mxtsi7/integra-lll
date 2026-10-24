"""Serializadores del servicio de notificaciones."""

from rest_framework import serializers

from .models import Alerta


class AlertaSerializer(serializers.ModelSerializer):
    """Lo que ve el usuario de una alerta.

    Solo lectura entera: una alerta no se edita desde afuera. Cambiar su
    estado se hace con las acciones `leer` y `revisar`, que son verbos del
    dominio y no un PATCH a un campo suelto.
    """

    tipo_legible = serializers.CharField(source="get_tipo_display", read_only=True)
    lectura_legible = serializers.CharField(source="get_lectura_display", read_only=True)
    pendiente = serializers.BooleanField(read_only=True)

    class Meta:
        model = Alerta
        fields = (
            "id",
            "tipo",
            "tipo_legible",
            "titulo",
            "mensaje",
            "suscripcion_id",
            "datos",
            "lectura",
            "lectura_legible",
            "pendiente",
            "leida_en",
            "revisada_en",
            "creado_en",
        )
        read_only_fields = fields
        # `evento_id` no sale: es de plomería interna (la idempotencia del
        # consumidor de FE-24) y al usuario no le dice nada.


class ContadorSerializer(serializers.Serializer):
    """La respuesta del contador de la campana (FE-20)."""

    pendientes = serializers.IntegerField(read_only=True)
    total = serializers.IntegerField(read_only=True)

"""Serializadores del servicio de notificaciones."""

from django.conf import settings
from rest_framework import serializers

from .models import Alerta, PreferenciaNotificacion


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


# ── Preferencias de notificación (FE-21 / RF-09) ─────────────────────


class PreferenciaNotificacionSerializer(serializers.ModelSerializer):
    """Lo que se lee y lo que se puede cambiar.

    ── Por qué `canales_disponibles` es de solo lectura ─────────────────────
    Es información del servidor, no una preferencia: dice qué canales están
    realmente habilitados hoy. El frontend lo usa para no prometer un push que
    nadie va a entregar, mientras la preferencia igual queda guardada.

    ── Por qué `organizacion_id` y `usuario_id` no se pueden mandar ─────────
    Salen de las cabeceras que inyecta el gateway. Si se pudieran mandar en el
    cuerpo, cualquiera cambiaría las preferencias de otro.
    """

    canales_disponibles = serializers.SerializerMethodField(
        help_text=(
            "Qué canales están entregables HOY. Un canal encendido que no "
            "esté acá guarda la intención pero todavía no llega."
        )
    )
    canales_elegidos = serializers.SerializerMethodField(
        help_text="Los que la persona tiene encendidos, estén entregables o no."
    )

    class Meta:
        model = PreferenciaNotificacion
        fields = (
            "por_email",
            "por_push",
            "en_la_app",
            "avisar_proximo_cobro",
            "avisar_fin_prueba",
            "avisar_alza_tarifa",
            "avisar_doble_cobro",
            "avisar_presupuesto_excedido",
            "dias_anticipacion",
            "canales_disponibles",
            "canales_elegidos",
            "actualizado_en",
        )
        read_only_fields = ("actualizado_en",)

    def get_canales_disponibles(self, _obj) -> list:
        return list(getattr(settings, "CANALES_HABILITADOS", []))

    def get_canales_elegidos(self, obj) -> list:
        return obj.canales_elegidos()

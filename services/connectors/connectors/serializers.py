"""
Serializers del servicio de conectores (FE-01).

Los tokens entran por acá y no salen nunca. Hay dos capas, a propósito:

1. **Los campos se listan explícitos** y los tokens no están en la lista. Es
   lo que se lee al revisar el archivo: queda a la vista qué se expone.
2. **Y si alguien los agrega igual**, ``CampoCifrado`` está registrado en el
   mapeo de ``ModelSerializer`` (FE-06), así que DRF los construye
   ``write_only`` solo. La protección no depende de esta lista.

La segunda capa es la que vale: la primera se puede romper editando una
línea sin darse cuenta.
"""

from rest_framework import serializers

from shared.cifrado import CampoSecretoSerializer

from .models import CuentaConectada


class CuentaConectadaSerializer(serializers.ModelSerializer):
    """Lo que ve el usuario de una cuenta conectada."""

    # Declarados para poder recibirlos en el alta sin que sean obligatorios.
    # Salen `write_only` por el propio campo, no por esta declaración.
    access_token = CampoSecretoSerializer(required=False, allow_blank=True)
    refresh_token = CampoSecretoSerializer(required=False, allow_blank=True)

    necesita_reautorizacion = serializers.BooleanField(read_only=True)
    proveedor_legible = serializers.CharField(source="get_proveedor_display", read_only=True)
    estado_legible = serializers.CharField(source="get_estado_display", read_only=True)

    class Meta:
        model = CuentaConectada
        fields = (
            "id",
            "proveedor",
            "proveedor_legible",
            "cuenta_externa",
            "estado",
            "estado_legible",
            "detalle_del_estado",
            "necesita_reautorizacion",
            "token_expira_en",
            "ultima_sincronizacion",
            "creado_en",
            "actualizado_en",
            # Entran, no salen:
            "access_token",
            "refresh_token",
        )
        read_only_fields = (
            "id",
            "estado",
            "detalle_del_estado",
            "ultima_sincronizacion",
            "creado_en",
            "actualizado_en",
        )

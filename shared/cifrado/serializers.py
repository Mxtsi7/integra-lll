"""
``CampoSecretoSerializer``: un campo de DRF por el que un secreto **entra**
(POST/PATCH) y por el que **nunca sale** (GET).

Es ``write_only`` a la fuerza: aunque alguien lo declare con
``write_only=False``, se ignora. Es la mitad "no exponer secretos en el
serializer" de FE-01 y RN-SEG-001.

    class CuentaConectadaSerializer(serializers.ModelSerializer):
        access_token = CampoSecretoSerializer(required=False)
        refresh_token = CampoSecretoSerializer(required=False)

Ojo: un ``ModelSerializer`` con ``fields = "__all__"`` sobre un modelo con
``CampoCifrado`` **sí devolvería el texto plano**, porque Django ya lo
descifró. Los campos cifrados se declaran siempre explícitos con este
serializer, o se dejan fuera de ``fields``.
"""

from rest_framework import serializers


class CampoSecretoSerializer(serializers.CharField):
    def __init__(self, **kwargs):
        kwargs["write_only"] = True
        kwargs.setdefault("trim_whitespace", False)
        kwargs.setdefault("style", {"input_type": "password"})
        super().__init__(**kwargs)

    def to_representation(self, value):
        # DRF no llama a esto en un campo write_only. Si alguien lo fuerza, que
        # salte acá y no en una respuesta HTTP con el token adentro.
        raise AssertionError("CampoSecretoSerializer nunca se representa en una respuesta")

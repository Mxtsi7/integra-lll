"""
``CampoSecretoSerializer``: un campo de DRF por el que un secreto **entra**
(POST/PATCH) y por el que **nunca sale** (GET).

Es ``write_only`` a la fuerza: aunque alguien lo declare con
``write_only=False``, se ignora. Es la mitad "no exponer secretos en el
serializer" de FE-01 y RN-SEG-001.

    class CuentaConectadaSerializer(serializers.ModelSerializer):
        access_token = CampoSecretoSerializer(required=False)
        refresh_token = CampoSecretoSerializer(required=False)

Declararlo es opcional: al final de este módulo, ``CampoCifrado`` queda
registrado en el mapeo de ``ModelSerializer``, así que un
``fields = "__all__"`` construye este campo por sí solo. Declararlo sirve
para ponerle ``required``, ``allow_null`` y demás.
"""

from rest_framework import serializers

from .campos import CampoCifrado


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


# ── Seguro por omisión ───────────────────────────────────────────────
# Sin esta línea, un ``ModelSerializer`` con ``fields = "__all__"`` sobre un
# modelo con ``CampoCifrado`` construye un ``CharField`` común y devuelve el
# secreto YA DESCIFRADO en la respuesta: Django lo descifró al leerlo de la
# base, y DRF no tiene forma de saber que era un secreto.
#
# ``serializer_field_mapping`` es el diccionario con que ``ModelSerializer``
# decide qué campo usar para cada campo del modelo. Registrando el nuestro,
# la protección deja de depender de que alguien se acuerde de declararlo.
#
# Se ejecuta al importar ``shared.cifrado``, que es lo que hace cualquiera que
# use ``CampoCifrado`` en un modelo.
serializers.ModelSerializer.serializer_field_mapping[CampoCifrado] = CampoSecretoSerializer

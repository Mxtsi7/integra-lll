"""El token entra por el serializer y nunca sale."""

import pytest
from rest_framework import serializers

from shared.cifrado import CampoCifrado, CampoSecretoSerializer
from shared.cifrado.tests.app_prueba.models import CuentaDePrueba

SECRETO = "ya29.token-de-prueba"


class SerializerSuelto(serializers.Serializer):
    nombre = serializers.CharField()
    token = CampoSecretoSerializer()


class CuentaSerializer(serializers.ModelSerializer):
    token = CampoSecretoSerializer(required=False)

    class Meta:
        model = CuentaDePrueba
        fields = ["id", "nombre", "token"]


def test_el_secreto_entra_pero_no_sale():
    serializer = SerializerSuelto(data={"nombre": "gmail", "token": SECRETO})
    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["token"] == SECRETO

    assert "token" not in serializer.data
    assert SECRETO not in str(serializer.data)


def test_write_only_no_se_puede_desactivar():
    campo = CampoSecretoSerializer(write_only=False)
    assert campo.write_only is True


def test_no_se_recortan_espacios_del_secreto():
    serializer = SerializerSuelto(data={"nombre": "x", "token": " con-espacio "})
    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["token"] == " con-espacio "


def test_representar_a_la_fuerza_falla_en_vez_de_filtrar():
    with pytest.raises(AssertionError):
        CampoSecretoSerializer().to_representation(SECRETO)


@pytest.mark.django_db
def test_model_serializer_crea_con_el_token_y_responde_sin_el(claves):
    serializer = CuentaSerializer(data={"nombre": "gmail", "token": SECRETO})
    assert serializer.is_valid(), serializer.errors
    cuenta = serializer.save()

    assert CuentaDePrueba.objects.get(pk=cuenta.pk).token == SECRETO

    respuesta = CuentaSerializer(cuenta).data
    assert set(respuesta) == {"id", "nombre"}
    assert SECRETO not in str(respuesta)


@pytest.mark.django_db
def test_un_model_serializer_con_todos_los_campos_no_expone_el_token(claves):
    """Lo importante: no hace falta declarar nada. Un ``fields = "__all__"``
    escrito sin pensar tampoco devuelve el secreto, porque ``CampoCifrado``
    está registrado en el mapeo de ``ModelSerializer``."""

    class Descuidado(serializers.ModelSerializer):
        class Meta:
            model = CuentaDePrueba
            fields = "__all__"

    cuenta = CuentaDePrueba.objects.create(
        nombre="x", token=SECRETO, otro_secreto=SECRETO
    )
    respuesta = Descuidado(CuentaDePrueba.objects.get(pk=cuenta.pk)).data

    assert "token" not in respuesta
    assert "otro_secreto" not in respuesta
    assert SECRETO not in str(respuesta)
    assert set(respuesta) == {"id", "nombre"}


def test_el_campo_cifrado_esta_registrado_en_el_mapeo():
    """Si alguien borra el registro del final de serializers.py, esto lo caza."""
    mapeo = serializers.ModelSerializer.serializer_field_mapping
    assert mapeo.get(CampoCifrado) is CampoSecretoSerializer


@pytest.mark.django_db
def test_un_model_serializer_con_todos_los_campos_igual_deja_escribir(claves):
    """El campo sigue siendo de escritura: el secreto entra, solo no sale."""

    class Descuidado(serializers.ModelSerializer):
        class Meta:
            model = CuentaDePrueba
            fields = "__all__"

    serializer = Descuidado(data={"nombre": "gmail", "token": SECRETO})
    assert serializer.is_valid(), serializer.errors
    cuenta = serializer.save()

    assert CuentaDePrueba.objects.get(pk=cuenta.pk).token == SECRETO

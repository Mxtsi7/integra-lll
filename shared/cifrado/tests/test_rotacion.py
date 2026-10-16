"""Rotación de claves sobre filas reales."""

import pytest
from django.db import connection

from shared.cifrado import SECRETO_ILEGIBLE, generar_clave, rotar_claves
from shared.cifrado.tests.app_prueba.models import CuentaDePrueba


def valor_en_bd(pk, campo="token"):
    tabla = CuentaDePrueba._meta.db_table
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT "{campo}" FROM "{tabla}" WHERE id = %s', [pk])
        return cursor.fetchone()[0]


@pytest.mark.django_db
def test_rotar_recifra_solo_lo_que_esta_con_la_clave_anterior(claves):
    vieja, nueva = generar_clave(), generar_clave()

    claves(vieja)
    con_vieja = [CuentaDePrueba.objects.create(nombre=f"v{i}", token=f"t{i}", otro_secreto=f"o{i}").pk for i in range(3)]
    sin_token = CuentaDePrueba.objects.create(nombre="vacia", token=None).pk

    claves(nueva, vieja)
    ya_nueva = CuentaDePrueba.objects.create(nombre="n", token="tn").pk
    antes_nueva = valor_en_bd(ya_nueva)

    resultado = rotar_claves(CuentaDePrueba.objects.all(), ["token", "otro_secreto"])

    assert resultado == {"revisadas": 5, "rotadas": 3, "ilegibles": 0}
    assert valor_en_bd(ya_nueva) == antes_nueva  # no se tocó
    assert valor_en_bd(sin_token) is None

    # Ahora se puede quitar la clave vieja y todo sigue legible.
    claves(nueva)
    for pk in con_vieja:
        cuenta = CuentaDePrueba.objects.get(pk=pk)
        assert cuenta.token == f"t{pk - con_vieja[0]}"
        assert cuenta.token.cifrado_con_clave_actual is True
        assert cuenta.otro_secreto.cifrado_con_clave_actual is True


@pytest.mark.django_db
def test_rotar_dos_veces_no_cambia_nada_la_segunda(claves):
    vieja, nueva = generar_clave(), generar_clave()
    claves(vieja)
    pk = CuentaDePrueba.objects.create(nombre="x", token="t").pk

    claves(nueva, vieja)
    assert rotar_claves(CuentaDePrueba.objects.all(), ["token"])["rotadas"] == 1
    despues = valor_en_bd(pk)
    assert rotar_claves(CuentaDePrueba.objects.all(), ["token"])["rotadas"] == 0
    assert valor_en_bd(pk) == despues


@pytest.mark.django_db
def test_rotar_cuenta_las_ilegibles_y_no_las_pisa(claves):
    perdida, vieja, nueva = generar_clave(), generar_clave(), generar_clave()

    claves(perdida)
    pk_perdida = CuentaDePrueba.objects.create(nombre="perdida", token="p").pk
    cifrado_perdido = valor_en_bd(pk_perdida)

    claves(vieja)
    pk_vieja = CuentaDePrueba.objects.create(nombre="vieja", token="v").pk

    claves(nueva, vieja)  # `perdida` ya no está
    resultado = rotar_claves(CuentaDePrueba.objects.all(), ["token"])

    assert resultado == {"revisadas": 2, "rotadas": 1, "ilegibles": 1}
    assert valor_en_bd(pk_perdida) == cifrado_perdido  # intacto para cuando vuelva la clave
    assert CuentaDePrueba.objects.get(pk=pk_perdida).token is SECRETO_ILEGIBLE
    assert CuentaDePrueba.objects.get(pk=pk_vieja).token.cifrado_con_clave_actual is True

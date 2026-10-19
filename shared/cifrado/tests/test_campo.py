"""CampoCifrado contra una base real (sqlite en memoria)."""

import logging

import pytest
from django.db import connection, transaction

from shared.cifrado import (
    SECRETO_ILEGIBLE,
    ClaveDeCifradoInvalida,
    SecretoIlegible,
    TextoDescifrado,
    generar_clave,
)
from shared.cifrado.tests.app_prueba.models import CuentaDePrueba

SECRETO = "ya29.token-de-gmail-de-prueba"


def valor_en_bd(pk, campo="token"):
    """Lo que hay de verdad en la columna, sin pasar por el campo."""
    tabla = CuentaDePrueba._meta.db_table
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT "{campo}" FROM "{tabla}" WHERE id = %s', [pk])
        return cursor.fetchone()[0]


@pytest.mark.django_db
def test_la_base_no_contiene_el_token_legible(claves):
    cuenta = CuentaDePrueba.objects.create(nombre="gmail", token=SECRETO)

    en_bd = valor_en_bd(cuenta.pk)
    assert en_bd != SECRETO
    assert SECRETO not in en_bd
    assert "token-de-gmail" not in en_bd
    assert en_bd.startswith("gAAAAA")  # token Fernet


@pytest.mark.django_db
def test_al_leer_vuelve_el_texto_plano(claves):
    pk = CuentaDePrueba.objects.create(nombre="gmail", token=SECRETO).pk

    leida = CuentaDePrueba.objects.get(pk=pk)
    assert leida.token == SECRETO
    assert isinstance(leida.token, TextoDescifrado)
    assert leida.token.cifrado_con_clave_actual is True


@pytest.mark.django_db
def test_none_se_guarda_como_null(claves):
    pk = CuentaDePrueba.objects.create(nombre="sin token", token=None).pk
    assert valor_en_bd(pk) is None
    assert CuentaDePrueba.objects.get(pk=pk).token is None


@pytest.mark.django_db
def test_no_se_puede_buscar_por_el_valor_cifrado(claves):
    CuentaDePrueba.objects.create(nombre="gmail", token=SECRETO)
    # Cada cifrado usa otro IV: la base no puede responder "quién tiene este token".
    assert not CuentaDePrueba.objects.filter(token=SECRETO).exists()


@pytest.mark.django_db
def test_una_fila_con_clave_perdida_no_rompe_a_las_demas(claves, caplog):
    clave_vieja = generar_clave()
    clave_nueva = generar_clave()

    claves(clave_vieja)
    pk_vieja = CuentaDePrueba.objects.create(nombre="vieja", token=SECRETO).pk

    claves(clave_nueva)  # la vieja ya no está en la lista
    pk_nueva = CuentaDePrueba.objects.create(nombre="nueva", token="otro").pk

    with caplog.at_level(logging.WARNING, logger="shared.cifrado.campos"):
        cuentas = {c.nombre: c for c in CuentaDePrueba.objects.all()}  # no lanza

    assert cuentas["nueva"].token == "otro"
    assert cuentas["vieja"].token is SECRETO_ILEGIBLE
    assert not cuentas["vieja"].token  # falsy: "esta cuenta requiere reautorizar"
    assert str(cuentas["vieja"].token) == "<secreto ilegible>"

    # El aviso en el log no incluye ni el cifrado ni el texto plano.
    registro = " ".join(r.getMessage() for r in caplog.records)
    assert "ilegible" in registro
    assert SECRETO not in registro
    assert valor_en_bd(pk_vieja) not in registro
    assert pk_nueva != pk_vieja


@pytest.mark.django_db
def test_un_secreto_ilegible_no_se_sobrescribe_al_guardar(claves):
    claves(generar_clave())
    cuenta = CuentaDePrueba.objects.create(nombre="x", token=SECRETO)
    original_en_bd = valor_en_bd(cuenta.pk)

    claves(generar_clave())
    cuenta = CuentaDePrueba.objects.get(pk=cuenta.pk)
    assert isinstance(cuenta.token, SecretoIlegible)

    # El atomic() es por la prueba: save() marca la transacción del test para
    # rollback al fallar; con un savepoint propio se puede seguir consultando.
    with pytest.raises(ClaveDeCifradoInvalida) as error, transaction.atomic():
        cuenta.save()
    assert original_en_bd not in str(error.value)
    assert valor_en_bd(cuenta.pk) == original_en_bd  # intacto

    # Otros campos sí se pueden actualizar sin tocar el secreto.
    cuenta.nombre = "renombrada"
    cuenta.save(update_fields=["nombre"])
    assert CuentaDePrueba.objects.get(pk=cuenta.pk).nombre == "renombrada"
    assert valor_en_bd(cuenta.pk) == original_en_bd


@pytest.mark.django_db
def test_con_la_clave_vieja_todavia_en_la_lista_se_lee_y_se_marca_para_rotar(claves):
    vieja, nueva = generar_clave(), generar_clave()
    claves(vieja)
    pk = CuentaDePrueba.objects.create(nombre="x", token=SECRETO).pk

    claves(nueva, vieja)
    cuenta = CuentaDePrueba.objects.get(pk=pk)
    assert cuenta.token == SECRETO
    assert cuenta.token.cifrado_con_clave_actual is False

    cuenta.save(update_fields=["token"])  # re-cifra con la nueva
    assert CuentaDePrueba.objects.get(pk=pk).token.cifrado_con_clave_actual is True


@pytest.mark.django_db
def test_cada_guardado_vuelve_a_cifrar_con_la_clave_vigente(claves):
    cuenta = CuentaDePrueba.objects.create(nombre="x", token=SECRETO)
    antes = valor_en_bd(cuenta.pk)
    cuenta.save()
    assert valor_en_bd(cuenta.pk) != antes  # otro IV, mismo contenido
    assert CuentaDePrueba.objects.get(pk=cuenta.pk).token == SECRETO


@pytest.mark.django_db
def test_dumpdata_no_exporta_el_texto_plano(claves):
    cuenta = CuentaDePrueba.objects.create(nombre="x", token=SECRETO)
    campo = CuentaDePrueba._meta.get_field("token")
    assert campo.value_to_string(cuenta) == "***"


def test_secreto_ilegible_se_compara_consigo_mismo():
    assert SecretoIlegible() == SECRETO_ILEGIBLE
    assert SECRETO_ILEGIBLE != ""
    assert SECRETO_ILEGIBLE != "<secreto ilegible>"
    assert {SECRETO_ILEGIBLE, SecretoIlegible()} == {SECRETO_ILEGIBLE}

"""Pruebas del cifrador puro, sin Django ni base de datos."""

import pytest

from shared.cifrado.cifrador import (
    VARIABLE_DE_ENTORNO,
    Cifrador,
    CifradoNoConfigurado,
    ClaveDeCifradoInvalida,
    generar_clave,
    obtener_cifrador,
    redactar,
    reiniciar_cifrador,
)

SECRETO = "ya29.a0AfH6SMB-token-de-prueba-ñandú-🔐"


def test_cifrar_y_descifrar_devuelve_el_mismo_texto():
    cifrador = Cifrador([generar_clave()])
    assert cifrador.descifrar(cifrador.cifrar(SECRETO)) == SECRETO


def test_lo_guardado_no_contiene_el_texto_plano_y_cambia_cada_vez():
    cifrador = Cifrador([generar_clave()])
    uno = cifrador.cifrar(SECRETO)
    dos = cifrador.cifrar(SECRETO)

    assert SECRETO not in uno
    assert "token-de-prueba" not in uno
    assert uno != dos  # IV distinto en cada cifrado: no se puede comparar ni buscar
    assert uno.isascii()  # cabe en una columna de texto cualquiera


def test_con_otra_clave_no_se_descifra_y_el_error_no_filtra_nada():
    clave_a, clave_b = generar_clave(), generar_clave()
    cifrado = Cifrador([clave_a]).cifrar(SECRETO)

    with pytest.raises(ClaveDeCifradoInvalida) as error:
        Cifrador([clave_b]).descifrar(cifrado)

    mensaje = str(error.value)
    assert SECRETO not in mensaje
    assert cifrado not in mensaje
    assert clave_a not in mensaje and clave_b not in mensaje
    assert error.value.__cause__ is None  # sin la excepción interna encadenada


def test_un_dato_alterado_en_la_base_no_se_acepta():
    cifrador = Cifrador([generar_clave()])
    cifrado = cifrador.cifrar(SECRETO)
    alterado = cifrado[:-6] + ("AAAAAA" if not cifrado.endswith("AAAAAA") else "BBBBBB")

    with pytest.raises(ClaveDeCifradoInvalida):
        cifrador.descifrar(alterado)


def test_texto_plano_guardado_sin_cifrar_tampoco_se_acepta():
    with pytest.raises(ClaveDeCifradoInvalida):
        Cifrador([generar_clave()]).descifrar("esto-no-es-un-token-fernet")


def test_la_primera_clave_cifra_y_todas_descifran():
    vieja, nueva = generar_clave(), generar_clave()
    cifrado_viejo = Cifrador([vieja]).cifrar(SECRETO)

    rotando = Cifrador([nueva, vieja])
    assert rotando.descifrar(cifrado_viejo) == SECRETO
    assert rotando.cifrado_con_clave_actual(cifrado_viejo) is False

    cifrado_nuevo = rotando.rotar(cifrado_viejo)
    assert rotando.cifrado_con_clave_actual(cifrado_nuevo) is True
    assert Cifrador([nueva]).descifrar(cifrado_nuevo) == SECRETO  # ya no necesita la vieja


def test_sin_claves_no_arranca():
    with pytest.raises(CifradoNoConfigurado):
        Cifrador([])
    with pytest.raises(CifradoNoConfigurado):
        Cifrador(["", "  "])


def test_una_clave_mal_formada_se_rechaza_sin_mostrarla():
    with pytest.raises(CifradoNoConfigurado) as error:
        Cifrador([generar_clave(), "esto-no-es-base64-de-32-bytes"])
    assert "#2" in str(error.value)
    assert "esto-no-es" not in str(error.value)


def test_desde_entorno_lee_la_variable_y_falla_si_falta(monkeypatch):
    monkeypatch.delenv(VARIABLE_DE_ENTORNO, raising=False)
    with pytest.raises(CifradoNoConfigurado):
        Cifrador.desde_entorno()

    a, b = generar_clave(), generar_clave()
    monkeypatch.setenv(VARIABLE_DE_ENTORNO, f"{a}, {b}")  # tolera espacios
    assert Cifrador.desde_entorno().cantidad_de_claves == 2


def test_obtener_cifrador_cachea_y_reiniciar_lo_olvida(monkeypatch):
    monkeypatch.setenv(VARIABLE_DE_ENTORNO, generar_clave())
    reiniciar_cifrador()
    primero = obtener_cifrador()
    assert obtener_cifrador() is primero

    monkeypatch.setenv(VARIABLE_DE_ENTORNO, generar_clave())
    assert obtener_cifrador() is primero  # sigue el viejo hasta reiniciar
    reiniciar_cifrador()
    assert obtener_cifrador() is not primero


def test_solo_se_cifra_texto():
    with pytest.raises(TypeError):
        Cifrador([generar_clave()]).cifrar(b"bytes")


def test_generar_clave_es_una_clave_fernet_valida():
    clave = generar_clave()
    assert len(clave) == 44
    Cifrador([clave])


def test_redactar_nunca_devuelve_el_valor():
    assert redactar(SECRETO) == "***"
    assert SECRETO not in redactar(SECRETO)
    assert redactar(None) == "(vacío)"
    assert redactar("") == "(vacío)"

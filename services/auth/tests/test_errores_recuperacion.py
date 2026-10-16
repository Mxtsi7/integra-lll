import logging
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from app.models import TokenRecuperacionUsado, User
from app.recuperacion import generador_token, generar_token_compuesto, huella_token
from shared.sesiones import registrar_credenciales, sesion_vigente

URL = "/api/auth/password-reset/confirm/"
AHORA = datetime(2026, 10, 14, 12)


@pytest.fixture
def usuario(db):
    return User.objects.create_user(email="privado@test.com", nombre="Nombre privado", password="Anterior123")


def confirmar(token):
    return APIClient().post(URL, {"token": token, "password": "NuevaClave123"}, format="json")


def comprobar_error(respuesta, estado, codigo, usuario, token):
    assert respuesta.status_code == estado
    assert respuesta.data["code"] == codigo
    assert respuesta.data["solicitar_nuevo_enlace"] == "/api/auth/password-reset/"
    assert "Solicita uno nuevo" in respuesta.data["detail"]
    assert set(respuesta.data) == {"code", "detail", "solicitar_nuevo_enlace"}
    cuerpo = respuesta.content.decode()
    for privado in (usuario.email, usuario.nombre, usuario.password, token):
        assert privado not in cuerpo


@pytest.mark.django_db
@pytest.mark.parametrize("segundos", [3599, 3600, 3601])
def test_limite_de_caducidad_con_codigo_estable(usuario, segundos):
    with patch.object(generador_token, "_now", return_value=AHORA):
        token = generar_token_compuesto(usuario)
    with patch.object(generador_token, "_now", return_value=AHORA + timedelta(seconds=segundos)):
        respuesta = confirmar(token)
    if segundos < 3600:
        assert respuesta.status_code == 200
    else:
        comprobar_error(respuesta, 410, "token_expirado", usuario, token)
        assert not TokenRecuperacionUsado.objects.exists()
        usuario.refresh_from_db()
        assert usuario.check_password("Anterior123")


@pytest.mark.django_db
def test_firma_alterada_de_token_vencido_es_invalido_sin_cambiar_sesion(usuario):
    version = registrar_credenciales(usuario)
    with patch.object(generador_token, "_now", return_value=AHORA):
        token = generar_token_compuesto(usuario)
    alterado = token[:-1] + ("0" if token[-1] != "0" else "1")
    with patch.object(generador_token, "_now", return_value=AHORA + timedelta(minutes=61)):
        comprobar_error(confirmar(alterado), 400, "token_invalido", usuario, alterado)
    usuario.refresh_from_db()
    assert usuario.check_password("Anterior123")
    assert sesion_vigente(usuario.pk, version)
    assert not TokenRecuperacionUsado.objects.exists()


@pytest.mark.django_db
def test_reutilizacion_es_410_sin_guardar_token_o_exponerlo_en_logs(usuario, caplog):
    token = generar_token_compuesto(usuario)
    assert confirmar(token).status_code == 200
    registro = TokenRecuperacionUsado.objects.get()
    assert registro.huella == huella_token(token)
    assert len(registro.huella) == 64
    assert token not in registro.huella
    usuario.refresh_from_db()
    hash_nuevo = usuario.password
    with caplog.at_level(logging.DEBUG):
        comprobar_error(confirmar(token), 410, "token_usado", usuario, token)
    assert token not in caplog.text
    usuario.refresh_from_db()
    assert usuario.password == hash_nuevo
    assert TokenRecuperacionUsado.objects.count() == 1


@pytest.mark.django_db
def test_usado_mantiene_codigo_aunque_pase_la_caducidad(usuario):
    with patch.object(generador_token, "_now", return_value=AHORA):
        token = generar_token_compuesto(usuario)
        assert confirmar(token).status_code == 200
    with patch.object(generador_token, "_now", return_value=AHORA + timedelta(minutes=61)):
        comprobar_error(confirmar(token), 410, "token_usado", usuario, token)


@pytest.mark.django_db
def test_error_permite_pedir_otro_enlace_y_completar_el_flujo(usuario, mailoutbox):
    from urllib.parse import parse_qs, urlparse
    with patch.object(generador_token, "_now", return_value=AHORA):
        token = generar_token_compuesto(usuario)
    with patch.object(generador_token, "_now", return_value=AHORA + timedelta(minutes=61)):
        respuesta = confirmar(token)
        assert respuesta.status_code == 410
        solicitud = APIClient().post(respuesta.data["solicitar_nuevo_enlace"], {"email": usuario.email}, format="json")
        assert solicitud.status_code == 200
        enlace = next(linea for linea in mailoutbox[0].body.splitlines() if "token=" in linea)
        nuevo = parse_qs(urlparse(enlace).query)["token"][0]
        assert confirmar(nuevo).status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize("cuerpo", [
    {}, {"token": None}, {"token": ""}, {"token": "a" * 513}, {"token": "\ufffd"},
])
def test_token_ausente_o_malformado_ofrece_misma_salida(cuerpo):
    respuesta = APIClient().post(URL, {"password": "NuevaClave123", **cuerpo}, format="json")
    assert respuesta.status_code == 400
    assert respuesta.data["code"] == "token_invalido"
    assert respuesta.data["solicitar_nuevo_enlace"] == "/api/auth/password-reset/"


@pytest.mark.django_db
def test_fallo_transaccional_no_marca_el_token_como_usado(usuario):
    token = generar_token_compuesto(usuario)
    with patch("app.recuperacion.User.save", side_effect=RuntimeError("fallo de escritura")):
        with pytest.raises(RuntimeError):
            confirmar(token)
    assert not TokenRecuperacionUsado.objects.exists()
    usuario.refresh_from_db()
    assert usuario.check_password("Anterior123")
    assert confirmar(token).status_code == 200


@pytest.mark.django_db
def test_json_con_surrogate_no_produce_error_interno():
    respuesta = APIClient().post(
        URL, data=r'{"token":"\ud800","password":"NuevaClave123"}',
        content_type="application/json",
    )
    assert respuesta.status_code == 400
    assert respuesta.data["code"] == "token_invalido"


@pytest.mark.django_db
def test_schema_publica_los_codigos_y_la_accion_de_recuperacion():
    from drf_spectacular.generators import SchemaGenerator
    schema = SchemaGenerator().get_schema(public=True)
    respuestas = schema["paths"][URL]["post"]["responses"]
    assert {"200", "400", "410", "503"} <= set(respuestas)
    error = schema["components"]["schemas"]["ErrorRecuperacion"]
    assert {"code", "detail", "solicitar_nuevo_enlace"} <= set(error["properties"])


@pytest.mark.django_db
@pytest.mark.parametrize("estado", ["inactivo", "eliminado", "sin_password"])
def test_usuario_no_disponible_no_revela_el_motivo(usuario, estado):
    token = generar_token_compuesto(usuario)
    if estado == "eliminado":
        usuario.delete()
    elif estado == "inactivo":
        usuario.is_active = False
        usuario.save()
    else:
        usuario.set_unusable_password()
        usuario.save()
    comprobar_error(confirmar(token), 400, "token_invalido", usuario, token)

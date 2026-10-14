from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.db import close_old_connections, connection
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from redis.exceptions import ConnectionError
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from app.models import User
from app.recuperacion import generador_token, generar_token_compuesto
from shared.sesiones import sesion_vigente

URL = "/api/auth/password-reset/confirm/"
NUEVA = "NuevaClave123"


@pytest.fixture
def usuario(db):
    return User.objects.create_user(email="ana@test.com", password="Anterior123", nombre="Ana")


def confirmar(token, password=NUEVA):
    return APIClient().post(URL, {"token": token, "password": password}, format="json")


def login(usuario, password):
    return APIClient().post(
        "/api/auth/login/", {"email": usuario.email, "password": password}, format="json",
    )


@pytest.mark.django_db
def test_enlace_del_correo_cambia_hash_y_solo_la_nueva_clave_autentica(usuario, mailoutbox):
    APIClient().post("/api/auth/password-reset/", {"email": usuario.email}, format="json")
    enlace = next(linea for linea in mailoutbox[0].body.splitlines() if "token=" in linea)
    token = parse_qs(urlparse(enlace).query)["token"][0]
    anterior = usuario.password
    respuesta = confirmar(token)
    assert respuesta.status_code == 200
    assert "access_token" not in respuesta.data
    usuario.refresh_from_db()
    assert usuario.password != anterior and usuario.password != NUEVA
    assert usuario.check_password(NUEVA)
    assert login(usuario, "Anterior123").status_code == 401
    assert login(usuario, NUEVA).status_code == 200


@pytest.mark.django_db
def test_no_reutiliza_ni_otro_enlace_previo(usuario):
    token = generar_token_compuesto(usuario)
    assert confirmar(token).status_code == 200
    assert confirmar(token, "SegundaClave123").status_code == 400
    usuario.refresh_from_db()
    assert usuario.check_password(NUEVA)


@pytest.mark.django_db
@pytest.mark.parametrize("password", ["Abc1234", "sololetras", "12345678", "", "        "])
def test_politica_rechaza_sin_consumir_token(usuario, password):
    token = generar_token_compuesto(usuario)
    assert confirmar(token, password).status_code == 400
    usuario.refresh_from_db()
    assert usuario.check_password("Anterior123")
    assert confirmar(token).status_code == 200


@pytest.mark.django_db
def test_password_con_espacios_se_conserva(usuario):
    assert confirmar(generar_token_compuesto(usuario), " Clave123 ").status_code == 200
    usuario.refresh_from_db()
    assert usuario.check_password(" Clave123 ")


@pytest.mark.django_db
@pytest.mark.parametrize("cuerpo", [{}, {"token": "abc"}, {"password": NUEVA}, {"token": None, "password": NUEVA}])
def test_campos_obligatorios(cuerpo):
    assert APIClient().post(URL, cuerpo, format="json").status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("token", ["invalido", "..", "%%%.abc", "a" * 513,
    urlsafe_base64_encode(force_bytes(2**100)) + ".abc"])
def test_tokens_malformados_no_producen_500(usuario, token):
    assert confirmar(token).status_code == 400
    usuario.refresh_from_db()
    assert usuario.check_password("Anterior123")


@pytest.mark.django_db
def test_caducidad_exacta_y_usuario_inactivo(usuario):
    ahora = datetime(2026, 10, 14, 12)
    with patch.object(generador_token, "_now", return_value=ahora):
        token = generar_token_compuesto(usuario)
    with patch.object(generador_token, "_now", return_value=ahora + timedelta(minutes=60)):
        assert confirmar(token).status_code == 400
    usuario.is_active = False
    usuario.save()
    assert confirmar(generar_token_compuesto(usuario)).status_code == 400


@pytest.mark.django_db
def test_token_alterado_o_de_usuario_eliminado(usuario):
    token = generar_token_compuesto(usuario)
    assert confirmar(token + "x").status_code == 400
    usuario.delete()
    assert confirmar(token).status_code == 400


@pytest.mark.django_db
def test_reset_revoca_sesiones_previas_y_preserva_otro_usuario(usuario):
    otro = User.objects.create_user(email="otro@test.com", password="Anterior123", nombre="Otro")
    previa = RefreshToken(login(usuario, "Anterior123").data["refresh_token"])
    ajena = RefreshToken(login(otro, "Anterior123").data["refresh_token"])
    assert sesion_vigente(usuario.pk, previa["session_version"])
    assert confirmar(generar_token_compuesto(usuario)).status_code == 200
    assert not sesion_vigente(usuario.pk, previa["session_version"])
    assert not sesion_vigente(usuario.pk, previa.access_token["session_version"])
    assert sesion_vigente(otro.pk, ajena["session_version"])
    nueva = RefreshToken(login(usuario, NUEVA).data["refresh_token"])
    assert sesion_vigente(usuario.pk, nueva["session_version"])


@pytest.mark.django_db
def test_redis_caido_no_cambia_password_ni_consume_enlace(usuario):
    token = generar_token_compuesto(usuario)
    with patch("app.recuperacion.registrar_credenciales", side_effect=ConnectionError()):
        assert confirmar(token).status_code == 503
    usuario.refresh_from_db()
    assert usuario.check_password("Anterior123")
    assert confirmar(token).status_code == 200


@pytest.mark.django_db
def test_login_no_entrega_tokens_si_redis_falla(usuario):
    with patch("app.views.registrar_credenciales", side_effect=ConnectionError()):
        respuesta = login(usuario, "Anterior123")
    assert respuesta.status_code == 503
    assert "access_token" not in respuesta.data


@pytest.mark.django_db
def test_registro_aplica_la_misma_politica():
    for password in ("sololetras", "12345678", "Abc1234"):
        respuesta = APIClient().post("/api/auth/register/", {
            "email": "nuevo@test.com", "nombre": "Nuevo", "password": password, "acepta_datos": True,
        }, format="json")
        assert respuesta.status_code == 400
    assert not User.objects.filter(email="nuevo@test.com").exists()


@pytest.mark.django_db(transaction=True)
def test_dos_peticiones_simultaneas_solo_consumen_una_vez(usuario):
    if connection.vendor != "postgresql":
        pytest.skip("La concurrencia requiere los bloqueos reales de PostgreSQL")
    token = generar_token_compuesto(usuario)
    barrera = Barrier(2)
    def enviar(password):
        close_old_connections()
        try:
            barrera.wait(timeout=10)
            return password, confirmar(token, password).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        resultados = list(pool.map(enviar, [NUEVA, "OtraClave456"]))
    assert sorted(estado for _, estado in resultados) == [200, 400]
    usuario.refresh_from_db()
    ganadora = next(password for password, estado in resultados if estado == 200)
    assert usuario.check_password(ganadora)

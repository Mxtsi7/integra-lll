"""Google externo siempre simulado; PostgreSQL y JWT locales son reales."""

from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import time

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone
from google.auth.exceptions import TransportError
import jwt
import pytest
from redis.exceptions import RedisError
from rest_framework.test import APIClient

from app.google_login import COOKIE, huella
from app.models import IdentidadGoogle, IntentoGoogle, Organizacion, User


@pytest.fixture(autouse=True)
def cliente_google(settings):
    settings.GOOGLE_CLIENT_ID = "cliente-prueba.apps.googleusercontent.com"
    settings.DEBUG = True


@pytest.fixture
def usuario(db):
    return User.objects.create_user(email="ana@example.com", password="ClaveGoogle123",
                                    nombre="Ana", organizacion=Organizacion.objects.create(nombre="Hogar"), rol="titular")


def iniciar(cliente):
    respuesta = cliente.get("/api/auth/google/nonce/")
    assert respuesta.status_code == 200
    return respuesta.data["nonce"]


def claims(nonce_solicitado, **cambios):
    return {"iss": "https://accounts.google.com", "aud": settings.GOOGLE_CLIENT_ID,
            "email_verified": True, "sub": "google-sub-1", "email": "ana@example.com",
            "exp": time.time() + 600, "nonce": nonce_solicitado, **cambios}


def enviar(cliente, nonce, identidad=None, **campos):
    with patch("app.google_login.id_token.verify_oauth2_token", return_value=identidad or claims(nonce)) as verificador:
        respuesta = cliente.post("/api/auth/google/", {"id_token": "idtoken-mock", "nonce": nonce, **campos}, format="json")
    assert verificador.call_args.args[2] == settings.GOOGLE_CLIENT_ID
    return respuesta


@pytest.mark.django_db
def test_primera_vinculacion_exige_password_y_emite_proveedor(usuario):
    cliente = APIClient()
    nonce = iniciar(cliente)
    assert enviar(cliente, nonce).data["code"] == "vincular_google"
    assert not IdentidadGoogle.objects.exists()
    nonce = iniciar(cliente)
    respuesta = enviar(cliente, nonce, password="ClaveGoogle123")
    assert respuesta.status_code == 200
    assert IdentidadGoogle.objects.get().usuario == usuario
    for campo in ("access_token", "refresh_token"):
        token = jwt.decode(respuesta.data[campo], settings.JWT_SECRET, algorithms=["HS256"])
        assert token["proveedor"] == "google"
        assert token["organizacion_id"] == str(usuario.organizacion_id)
        assert token["rol"] == "titular" and token["sid"]
    assert respuesta.cookies[COOKIE]["max-age"] == 0
    renovada = cliente.post("/api/auth/refresh/", {"refresh_token": respuesta.data["refresh_token"]}, format="json")
    assert renovada.status_code == 200
    assert jwt.decode(renovada.data["access_token"], settings.JWT_SECRET, algorithms=["HS256"])["proveedor"] == "google"


@pytest.mark.django_db
def test_subject_ligado_no_depende_de_correo_del_proveedor(usuario):
    IdentidadGoogle.objects.create(usuario=usuario, subject="google-sub-1")
    cliente = APIClient()
    nonce = iniciar(cliente)
    respuesta = enviar(cliente, nonce, claims(nonce, email="correo-nuevo@example.com"))
    assert respuesta.status_code == 200
    assert respuesta.data["usuario"]["id"] == usuario.pk
    usuario.refresh_from_db()
    assert usuario.email == "ana@example.com"


@pytest.mark.django_db
def test_nueva_identidad_no_crea_cuenta_sin_consentimiento():
    cliente = APIClient()
    nonce = iniciar(cliente)
    respuesta = enviar(cliente, nonce)
    assert respuesta.status_code == 409 and respuesta.data["code"] == "completar_registro"
    assert not User.objects.exists() and not IdentidadGoogle.objects.exists()
    assert "access_token" not in respuesta.data


@pytest.mark.django_db
@pytest.mark.parametrize("cambio", [{"iss": "https://evil.example"}, {"aud": "otro-cliente"},
    {"email_verified": False}, {"email_verified": "true"}, {"sub": ""}, {"sub": 23},
    {"exp": 1}, {"nonce": "otro-nonce"}, {"email": "sin-formato"}])
def test_rechaza_claims_no_validos(usuario, cambio):
    cliente = APIClient()
    nonce = iniciar(cliente)
    respuesta = enviar(cliente, nonce, claims(nonce, **cambio), password="ClaveGoogle123")
    assert respuesta.status_code == 401
    assert not IdentidadGoogle.objects.exists()


@pytest.mark.django_db
def test_rechaza_firma_invalida_y_caida_del_proveedor(usuario):
    cliente = APIClient()
    nonce = iniciar(cliente)
    for error, estado in [(ValueError("firma inválida"), 401), (TransportError("red caída"), 503)]:
        with patch("app.google_login.id_token.verify_oauth2_token", side_effect=error):
            respuesta = cliente.post("/api/auth/google/", {"id_token": "idtoken-mock", "nonce": nonce}, format="json")
        assert respuesta.status_code == estado


@pytest.mark.django_db
def test_cookie_nonce_caducidad_y_un_solo_uso(usuario):
    cliente = APIClient()
    nonce = iniciar(cliente)
    cookie = cliente.cookies[COOKIE].value
    intruso = APIClient()
    assert enviar(intruso, nonce, password="ClaveGoogle123").status_code == 401
    IntentoGoogle.objects.filter(pk=huella(nonce)).update(vence_en=timezone.now() - timedelta(seconds=1))
    assert enviar(cliente, nonce, password="ClaveGoogle123").status_code == 401
    nonce = iniciar(cliente)
    cookie = cliente.cookies[COOKIE].value
    assert enviar(cliente, nonce, password="ClaveGoogle123").status_code == 200
    cliente.cookies[COOKIE] = cookie
    assert enviar(cliente, nonce, password="ClaveGoogle123").status_code == 401


@pytest.mark.django_db
def test_usuario_inactivo_y_no_reemplaza_subject(usuario):
    IdentidadGoogle.objects.create(usuario=usuario, subject="subject-original")
    cliente = APIClient()
    nonce = iniciar(cliente)
    assert enviar(cliente, nonce, password="ClaveGoogle123").status_code == 401
    usuario.is_active = False
    usuario.save(update_fields=["is_active"])
    nonce = iniciar(cliente)
    assert enviar(cliente, nonce, claims(nonce, sub="subject-original")).status_code == 401


@pytest.mark.django_db
def test_redis_caido_no_persiste_vinculo_ni_consume_intento(usuario):
    cliente = APIClient()
    nonce = iniciar(cliente)
    with patch("app.google_login.emitir_tokens", side_effect=RedisError("sin Redis")):
        assert enviar(cliente, nonce, password="ClaveGoogle123").status_code == 503
    assert not IdentidadGoogle.objects.exists()
    assert IntentoGoogle.objects.filter(pk=huella(nonce)).exists()


@pytest.mark.django_db
def test_cancelacion_y_desactivacion_no_emiten_sesion(settings):
    cliente = APIClient()
    with patch("app.google_login.id_token.verify_oauth2_token") as google:
        assert cliente.post("/api/auth/google/", {"error": "access_denied"}, format="json").data["code"] == "google_cancelado"
        settings.GOOGLE_CLIENT_ID = ""
        assert cliente.get("/api/auth/google/nonce/").status_code == 503
        assert cliente.post("/api/auth/google/", {}, format="json").status_code == 503
        google.assert_not_called()
    assert not IntentoGoogle.objects.exists()


@pytest.mark.django_db
def test_nonce_cookie_segura_y_datos_efimeros(settings):
    settings.DEBUG = False
    cliente = APIClient()
    nonce = iniciar(cliente)
    respuesta = cliente.get("/api/auth/google/nonce/")
    cookie = respuesta.cookies[COOKIE]
    assert cookie["secure"] and cookie["httponly"] and cookie["samesite"] == "Lax"
    intento = IntentoGoogle.objects.get(pk=huella(nonce))
    assert intento.navegador != cliente.cookies[COOKIE].value


@pytest.mark.django_db(transaction=True)
def test_nonce_no_admite_dos_logins_simultaneos(usuario):
    IdentidadGoogle.objects.create(usuario=usuario, subject="google-sub-1")
    cliente = APIClient()
    nonce = iniciar(cliente)
    cookie = cliente.cookies[COOKIE].value

    def autenticar(_):
        close_old_connections()
        try:
            otro = APIClient()
            otro.cookies[COOKIE] = cookie
            return otro.post("/api/auth/google/", {"id_token": "idtoken-mock", "nonce": nonce}, format="json").status_code
        finally:
            close_old_connections()

    with patch("app.google_login.id_token.verify_oauth2_token", return_value=claims(nonce)):
        with ThreadPoolExecutor(max_workers=2) as tareas:
            estados = list(tareas.map(autenticar, range(2)))
    assert sorted(estados) == [200, 401]

from unittest.mock import patch

import jwt
import pytest
from django.conf import settings
from django.core.cache import caches
from redis.exceptions import ConnectionError
from rest_framework.test import APIClient

from app.models import Sesion, User
from shared.sesiones import sesion_activa


@pytest.fixture
def usuario(db):
    return User.objects.create_user(email="sesion@example.test", password="Anterior123", nombre="Sesión")


def login(usuario):
    respuesta = APIClient().post("/api/auth/login/", {"email": usuario.email, "password": "Anterior123"})
    assert respuesta.status_code == 200
    return respuesta.data


def claims(token):
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITMO])


def vigente(token):
    datos = claims(token)
    return sesion_activa(datos["user_id"], datos["session_version"], datos["sid"])


def refresh(token):
    return APIClient().post("/api/auth/refresh/", {"refresh_token": token})


def test_logout_revoca_solo_su_dispositivo_y_su_refresh(usuario):
    primera, segunda = login(usuario), login(usuario)
    datos = claims(primera["access_token"])
    respuesta = APIClient().post("/api/auth/logout/", HTTP_X_USUARIO_ID=str(usuario.pk), HTTP_X_SESION_ID=datos["sid"])
    assert respuesta.status_code == 204
    assert not vigente(primera["access_token"])
    assert vigente(segunda["access_token"])
    assert refresh(primera["refresh_token"]).status_code == 401


def test_refresh_rotatorio_y_reutilizacion_revoca_familia(usuario):
    primera = login(usuario)
    renovada = refresh(primera["refresh_token"])
    assert renovada.status_code == 200
    assert vigente(renovada.data["access_token"])
    assert renovada.data["refresh_token"] != primera["refresh_token"]
    assert claims(renovada.data["refresh_token"])["exp"] == claims(primera["refresh_token"])["exp"]
    assert refresh(primera["refresh_token"]).status_code == 401
    assert not vigente(renovada.data["access_token"])
    assert refresh(renovada.data["refresh_token"]).status_code == 401


def test_access_vencido_no_impide_refresh_vigente(usuario):
    tokens = login(usuario)
    datos = claims(tokens["access_token"])
    datos["exp"] = 1
    access_vencido = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    respuesta = APIClient().post("/api/auth/refresh/", {"refresh_token": tokens["refresh_token"]},
                                HTTP_AUTHORIZATION=f"Bearer {access_vencido}")
    assert respuesta.status_code == 200


@pytest.mark.parametrize("valor", ["invalido", "", "eyJ.fake.token"])
def test_refresh_invalido_se_rechaza(usuario, valor):
    assert refresh(valor).status_code in (400, 401)


def test_reset_o_usuario_inactivo_impide_refresh(usuario):
    tokens = login(usuario)
    caches["sesiones"].delete(f"usuario:{usuario.pk}")
    assert refresh(tokens["refresh_token"]).status_code == 401
    tokens = login(usuario)
    usuario.is_active = False
    usuario.save(update_fields=["is_active"])
    assert refresh(tokens["refresh_token"]).status_code == 401


def test_redis_caido_no_entrega_tokens_rotados(usuario):
    tokens = login(usuario)
    jti = Sesion.objects.get().refresh_jti
    with patch("app.sesiones.sesion_activa", side_effect=ConnectionError()):
        assert refresh(tokens["refresh_token"]).status_code == 503
    assert Sesion.objects.get().refresh_jti == jti


def test_logout_no_admite_sid_de_otro_usuario(usuario):
    tokens = login(usuario)
    otro = User.objects.create_user(email="otro@example.test", password="Anterior123", nombre="Otro")
    assert APIClient().post("/api/auth/logout/", HTTP_X_USUARIO_ID=str(otro.pk), HTTP_X_SESION_ID=claims(tokens["access_token"])["sid"]).status_code == 401
    assert vigente(tokens["access_token"])


def test_sid_malformado_no_causa_error_interno(usuario):
    tokens = login(usuario)
    datos = claims(tokens["refresh_token"])
    datos["sid"] = "uuid-invalido"
    firmado = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    assert refresh(firmado).status_code == 401


def test_refresh_vencido_o_access_usado_como_refresh_se_rechaza(usuario):
    tokens = login(usuario)
    datos = claims(tokens["refresh_token"])
    datos["exp"] = 1
    vencido = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    assert refresh(vencido).status_code == 401
    assert refresh(tokens["access_token"]).status_code == 401

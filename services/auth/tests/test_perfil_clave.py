from unittest.mock import patch

import pytest
from redis.exceptions import ConnectionError
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from app.models import Organizacion, User
from shared.sesiones import sesion_activa


@pytest.fixture
def usuario(db):
    return User.objects.create_user(email="perfil@example.test", nombre="Antes", password="Anterior123",
                                    organizacion=Organizacion.objects.create(nombre="Hogar"), rol="titular")


def contexto(usuario):
    return {"HTTP_X_USUARIO_ID": str(usuario.pk), "HTTP_X_ORGANIZACION_ID": str(usuario.organizacion_id)}


def cambiar(usuario, **datos):
    cuerpo = {"password_actual": "Anterior123", "password": "NuevaClave123", "password_confirmacion": "NuevaClave123", **datos}
    return APIClient().post("/api/auth/change-password/", cuerpo, **contexto(usuario))


def test_cambio_clave_verifica_hash_y_revoca_todas_sus_sesiones(usuario):
    cliente = APIClient()
    tokens = cliente.post("/api/auth/login/", {"email": usuario.email, "password": "Anterior123"}).data
    anterior = RefreshToken(tokens["refresh_token"])
    assert cambiar(usuario).status_code == 200
    usuario.refresh_from_db()
    assert usuario.check_password("NuevaClave123")
    assert not usuario.check_password("Anterior123")
    assert not sesion_activa(usuario.pk, anterior["session_version"], anterior["sid"])
    assert cliente.post("/api/auth/refresh/", {"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert cliente.post("/api/auth/login/", {"email": usuario.email, "password": "NuevaClave123"}).status_code == 200


@pytest.mark.parametrize("datos", [
    {"password_actual": "Incorrecta123"}, {"password": "sin-numero", "password_confirmacion": "sin-numero"},
    {"password": "12345678", "password_confirmacion": "12345678"}, {"password_confirmacion": "OtraClave123"},
])
def test_clave_invalida_no_modifica_usuario(usuario, datos):
    hash_anterior = usuario.password
    assert cambiar(usuario, **datos).status_code == 400
    usuario.refresh_from_db()
    assert usuario.password == hash_anterior


def test_fallo_redis_no_persiste_clave(usuario):
    with patch("app.perfil.registrar_credenciales", side_effect=ConnectionError()):
        assert cambiar(usuario).status_code == 503
    usuario.refresh_from_db()
    assert usuario.check_password("Anterior123")


def test_patch_solo_cambia_nombre_y_conserva_contrato(usuario):
    respuesta = APIClient().patch("/api/usuarios/me/", {"nombre": "Actualizado"}, **contexto(usuario))
    assert respuesta.status_code == 200
    assert respuesta.data == {"id": usuario.pk, "nombre": "Actualizado", "correo": usuario.email,
                              "rol": "titular", "organizacion_id": str(usuario.organizacion_id)}


@pytest.mark.parametrize("datos", [{"nombre": ""}, {"nombre": " "}, {"nombre": "x" * 151},
                                  {"nombre": "Otro", "rol": "titular"}, {"email": "otro@example.test"},
                                  {"nombre": "Otro", "organizacion_id": "ajena"}])
def test_patch_rechaza_campos_no_permitidos(usuario, datos):
    assert APIClient().patch("/api/usuarios/me/", datos, **contexto(usuario)).status_code == 400
    usuario.refresh_from_db()
    assert usuario.nombre == "Antes"


def test_organizacion_ajena_y_usuario_inactivo_no_permiten_cambiar(usuario):
    datos = {**contexto(usuario), "HTTP_X_ORGANIZACION_ID": str(Organizacion.objects.create(nombre="Ajena").pk)}
    assert APIClient().patch("/api/usuarios/me/", {"nombre": "Otro"}, **datos).status_code == 403
    usuario.is_active = False
    usuario.save(update_fields=["is_active"])
    assert cambiar(usuario).status_code == 404


def test_sin_contexto_no_permite_cambio():
    assert APIClient().patch("/api/usuarios/me/", {"nombre": "Otro"}).status_code == 403

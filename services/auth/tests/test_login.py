import uuid

import jwt
import pytest
from django.conf import settings
from rest_framework.test import APIClient

from app.models import User


@pytest.fixture()
def usuario(db):
    return User.objects.create_user(
        email="ana@test.com",
        password="ClaveSegura123",
        nombre="Ana",
        organizacion_id=uuid.uuid4(),
        rol="titular",
    )


@pytest.mark.django_db
class TestLoginEndpoint:
    def test_login_devuelve_la_forma_que_espera_el_frontend(self, usuario):
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        assert resp.status_code == 200
        assert "access_token" in resp.data and "refresh_token" in resp.data
        assert resp.data["usuario"]["correo"] == "ana@test.com"

    def test_el_token_lleva_organizacion_id_y_rol(self, usuario):
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        payload = jwt.decode(
            resp.data["access_token"], settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITMO]
        )
        assert payload["organizacion_id"] == str(usuario.organizacion_id)
        assert payload["rol"] == "titular"

    def test_usuario_sin_organizacion_no_rompe_el_login(self, db):
        User.objects.create_user(email="sin-org@test.com", password="ClaveSegura123", nombre="Sin Org")
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "sin-org@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        payload = jwt.decode(
            resp.data["access_token"], settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITMO]
        )
        assert payload["organizacion_id"] is None
        assert payload["rol"] is None

    def test_credenciales_invalidas_devuelve_401(self, usuario):
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "incorrecta"},
            format="json",
        )
        assert resp.status_code == 401
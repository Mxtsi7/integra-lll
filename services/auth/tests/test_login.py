import jwt
import pytest
from django.conf import settings
from rest_framework.test import APIClient

from app.models import Organizacion, User


def _decode(token):
    key = getattr(settings, "JWT_SECRET", None) or settings.SIMPLE_JWT["SIGNING_KEY"]
    alg = getattr(settings, "JWT_ALGORITMO", None) or settings.SIMPLE_JWT["ALGORITHM"]
    return jwt.decode(token, key, algorithms=[alg])


@pytest.fixture()
def usuario(db):
    org = Organizacion.objects.create(nombre="Hogar de prueba")
    return User.objects.create_user(
        email="ana@test.com",
        password="ClaveSegura123",
        nombre="Ana",
        organizacion=org,
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
        r = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        claims = jwt.decode(
            r.data["access_token"],
            settings.SIMPLE_JWT["SIGNING_KEY"],
            algorithms=[settings.SIMPLE_JWT["ALGORITHM"]],
        )
        assert claims["organizacion_id"] == str(usuario.organizacion_id)
        assert claims["rol"] == "titular"

    def test_usuario_sin_organizacion_no_rompe_el_login(self, db):
        User.objects.create_user(
            email="sin-org@test.com",
            password="ClaveSegura123",
            nombre="Sin Org",
        )
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "sin-org@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        assert resp.status_code == 200
        payload = _decode(resp.data["access_token"])
        assert payload["organizacion_id"] is None
        assert payload["rol"] is None

    def test_credenciales_invalidas_devuelve_401(self, usuario):
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "incorrecta"},
            format="json",
        )
        assert resp.status_code == 401
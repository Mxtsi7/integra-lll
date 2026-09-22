import jwt
import pytest
from django.conf import settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from app.models import User


@pytest.mark.django_db
class TestLoginEndpoint:
    def setup_method(self):
        self.client = APIClient()
        self.url = reverse("login")
        self.password = "ClaveSegura123"
        self.user = User.objects.create_user(
            email="ana@test.com",
            password=self.password,
            nombre="Ana",
        )

    def test_login_exitoso_devuelve_tokens_y_usuario(self):
        response = self.client.post(
            self.url,
            {"email": "ana@test.com", "password": self.password},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert "access_token" in response.data
        assert "refresh_token" in response.data
        assert response.data["usuario"] == {
            "id": self.user.id,
            "nombre": "Ana",
            "correo": "ana@test.com",
        }
        assert "password" not in response.data["usuario"]

    def test_access_token_se_decodifica_con_jwt_secret(self):
        response = self.client.post(
            self.url,
            {"email": "ana@test.com", "password": self.password},
            format="json",
        )
        claims = jwt.decode(
            response.data["access_token"],
            settings.SIMPLE_JWT["SIGNING_KEY"],
            algorithms=[settings.SIMPLE_JWT["ALGORITHM"]],
        )
        assert claims["user_id"] == self.user.id
        assert "exp" in claims

    def test_login_con_dominio_en_mayusculas_funciona(self):
        response = self.client.post(
            self.url,
            {"email": "ANA@TEST.COM", "password": self.password},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK

    def test_login_password_incorrecta_devuelve_401_generico(self):
        response = self.client.post(
            self.url,
            {"email": "ana@test.com", "password": "otra-clave"},
            format="json",
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data["detail"] == "Correo o contraseña inválidos"

    def test_login_email_inexistente_devuelve_mismo_401_generico(self):
        response = self.client.post(
            self.url,
            {"email": "no-existe@test.com", "password": self.password},
            format="json",
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data["detail"] == "Correo o contraseña inválidos"

    def test_login_usuario_inactivo_no_puede_entrar(self):
        self.user.is_active = False
        self.user.save()
        response = self.client.post(
            self.url,
            {"email": "ana@test.com", "password": self.password},
            format="json",
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_login_sin_password_devuelve_400(self):
        response = self.client.post(
            self.url, {"email": "ana@test.com"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "password" in response.data

    def test_login_email_invalido_devuelve_400(self):
        response = self.client.post(
            self.url,
            {"email": "no-es-un-correo", "password": "x"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
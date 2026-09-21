import pytest
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

    def test_login_exitoso_devuelve_200_y_datos_publicos(self):
        response = self.client.post(
            self.url,
            {"email": "ana@test.com", "password": self.password},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data == {
            "id": self.user.id,
            "email": "ana@test.com",
            "nombre": "Ana",
        }
        assert "password" not in response.data

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
import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from app.models import User


@pytest.mark.django_db
class TestUserDetailEndpoint:
    def setup_method(self):
        self.client = APIClient()
        self.usuario = User.objects.create_user(
            email="ana@test.com",
            password="ClaveSegura123",
            nombre="Ana",
        )

    def test_get_usuario_existente_devuelve_200(self):
        url = reverse("user-detail", kwargs={"pk": self.usuario.id})
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert response.data["email"] == "ana@test.com"
        assert response.data["nombre"] == "Ana"
        assert "password" not in response.data

    def test_get_usuario_inexistente_devuelve_404_con_mensaje(self):
        url = reverse("user-detail", kwargs={"pk": 9999})
        response = self.client.get(url)

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "detail" in response.data
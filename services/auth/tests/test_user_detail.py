from django.urls import reverse
from rest_framework import status
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
import pytest
from rest_framework.test import APIClient

User = get_user_model()


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
            r = self.client.get(reverse("usuario-actual"), HTTP_X_USUARIO_ID=str(self.usuario.id))
            assert r.status_code == status.HTTP_200_OK
            assert r.data["email"] == "ana@test.com"

    def test_me_sin_cabecera_es_403(self):
        assert self.client.get(reverse("usuario-actual")).status_code == status.HTTP_403_FORBIDDEN

    def test_me_devuelve_el_usuario_del_token(self):
        r = self.client.get(reverse("usuario-actual"), HTTP_X_USUARIO_ID=str(self.usuario.id))
        assert r.status_code == status.HTTP_200_OK
        assert r.data["email"] == "ana@test.com"

    def test_me_sin_cabecera_es_403(self):
        assert self.client.get(reverse("usuario-actual")).status_code == status.HTTP_403_FORBIDDEN

    def test_no_puedo_leer_a_otro_usuario(self):
        otro = User.objects.create_user(email="beto@test.com", password="ClaveSegura123", nombre="Beto")
        url = reverse("user-detail", kwargs={"pk": otro.id})
        r = self.client.get(url, HTTP_X_USUARIO_ID=str(self.usuario.id))
        assert r.status_code == status.HTTP_404_NOT_FOUND
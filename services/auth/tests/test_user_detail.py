import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from app.models import User


@pytest.mark.django_db
class TestUsuarios:
    def setup_method(self):
        self.client = APIClient()
        self.usuario = User.objects.create_user(
            email="ana@test.com", password="ClaveSegura123", nombre="Ana",
        )

    # ── /api/usuarios/me/ ──────────────────────────────────────────

    def test_me_devuelve_el_usuario_del_token(self):
        r = self.client.get(reverse("usuario-actual"), HTTP_X_USUARIO_ID=str(self.usuario.id))
        assert r.status_code == status.HTTP_200_OK
        assert r.data["email"] == "ana@test.com"
        assert r.data["nombre"] == "Ana"
        assert "password" not in r.data

    def test_me_sin_cabecera_es_403(self):
        assert self.client.get(reverse("usuario-actual")).status_code == status.HTTP_403_FORBIDDEN

    # ── /api/usuarios/<id>/ ────────────────────────────────────────

    def test_get_usuario_existente_devuelve_200(self):
        url = reverse("usuario-detalle", kwargs={"pk": self.usuario.id})
        r = self.client.get(url, HTTP_X_USUARIO_ID=str(self.usuario.id))
        assert r.status_code == status.HTTP_200_OK
        assert r.data["email"] == "ana@test.com"
        assert r.data["nombre"] == "Ana"
        assert "password" not in r.data

    def test_get_usuario_inexistente_devuelve_404(self):
        url = reverse("usuario-detalle", kwargs={"pk": 9999})
        r = self.client.get(url, HTTP_X_USUARIO_ID=str(self.usuario.id))
        assert r.status_code == status.HTTP_404_NOT_FOUND
        assert "detail" in r.data

    def test_no_puedo_leer_a_otro_usuario(self):
        otro = User.objects.create_user(
            email="beto@test.com", password="ClaveSegura123", nombre="Beto",
        )
        url = reverse("usuario-detalle", kwargs={"pk": otro.id})
        r = self.client.get(url, HTTP_X_USUARIO_ID=str(self.usuario.id))
        assert r.status_code == status.HTTP_404_NOT_FOUND

    def test_detalle_sin_cabecera_es_403(self):
        url = reverse("usuario-detalle", kwargs={"pk": self.usuario.id})
        assert self.client.get(url).status_code == status.HTTP_403_FORBIDDEN
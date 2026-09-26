import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Organizacion, User


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
        assert r.data["correo"] == "ana@test.com"
        assert r.data["nombre"] == "Ana"
        assert "password" not in r.data
        # El correo viaja como `correo`, igual que en el login. `email` era el
        # nombre que obligaba a la web a probar los dos.
        assert "email" not in r.data

    def test_me_devuelve_rol_y_organizacion(self):
        org = Organizacion.objects.create(nombre="Hogar de Ana")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )

        r = self.client.get(reverse("usuario-actual"), HTTP_X_USUARIO_ID=str(titular.id))

        assert r.status_code == status.HTTP_200_OK
        assert r.data["rol"] == "titular"
        assert r.data["organizacion_id"] == str(org.id)
        # Sale como texto, no como objeto UUID: es lo que consume el frontend.
        assert isinstance(r.data["organizacion_id"], str)

    def test_me_de_usuario_sin_organizacion_devuelve_nulos(self):
        # El usuario de setup_method no tiene ni organizacion ni rol. La
        # pantalla de Perfil tiene que poder dibujarse igual.
        r = self.client.get(reverse("usuario-actual"), HTTP_X_USUARIO_ID=str(self.usuario.id))

        assert r.status_code == status.HTTP_200_OK
        assert r.data["rol"] is None
        assert r.data["organizacion_id"] is None

    def test_me_y_login_llaman_igual_al_correo(self):
        """Los dos endpoints de auth tienen que coincidir en el nombre.

        Cuando no coincidian, /me/ devolvia `email` y el login `correo`, y la
        web terminaba adivinando cual de los dos venia.
        """
        login = self.client.post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        assert login.status_code == status.HTTP_200_OK

        me = self.client.get(
            reverse("usuario-actual"), HTTP_X_USUARIO_ID=str(self.usuario.id)
        )

        assert login.data["usuario"]["correo"] == me.data["correo"]
        assert login.data["usuario"]["nombre"] == me.data["nombre"]
        assert login.data["usuario"]["id"] == me.data["id"]

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
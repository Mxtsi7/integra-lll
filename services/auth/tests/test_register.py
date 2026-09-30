import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from app.models import User


@pytest.mark.django_db
class TestRegisterEndpoint:
    def setup_method(self):
        self.client = APIClient()
        self.url = reverse("register")
        self.valid_payload = {
            "email": "ana@test.com",
            "password": "ClaveSegura123",
            "nombre": "Ana",
            "acepta_datos": True,
        }

    def test_register_exitoso_devuelve_201(self):
        response = self.client.post(self.url, self.valid_payload, format="json")

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["email"] == "ana@test.com"
        assert response.data["nombre"] == "Ana"
        assert "id" in response.data
        assert "password" not in response.data

        user = User.objects.get(email="ana@test.com")
        assert user.check_password("ClaveSegura123")
        assert user.password != "ClaveSegura123"
        assert user.consentimiento_en is not None

    def test_register_email_duplicado_devuelve_400(self):
        response1 = self.client.post(self.url, self.valid_payload, format="json")
        assert response1.status_code == status.HTTP_201_CREATED

        response2 = self.client.post(self.url, self.valid_payload, format="json")
        assert response2.status_code == status.HTTP_400_BAD_REQUEST
        assert "email" in response2.data

    def test_register_sin_email_devuelve_400(self):
        payload = {
            "password": "ClaveSegura123",
            "nombre": "Ana",
            "acepta_datos": True,
        }
        response = self.client.post(self.url, payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "email" in response.data

    def test_register_sin_password_devuelve_400(self):
        payload = {
            "email": "ana@test.com",
            "nombre": "Ana",
            "acepta_datos": True,
        }
        response = self.client.post(self.url, payload, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "password" in response.data

    def test_register_sin_nombre_devuelve_400(self):
        payload = {
            "email": "ana@test.com",
            "password": "ClaveSegura123",
            "acepta_datos": True,
        }
        response = self.client.post(self.url, payload, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "nombre" in response.data

    def test_register_sin_aceptar_datos_devuelve_400(self):
        payload = {**self.valid_payload, "acepta_datos": False}
        response = self.client.post(self.url, payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "acepta_datos" in response.data

    def test_al_registrarse_queda_como_titular_de_su_organizacion(self):
        self.client.post(
            reverse("register"),
            {
                "email": "ana@test.com",
                "password": "ClaveSegura123",
                "nombre": "Ana",
                "acepta_datos": True,
            },
            format="json",
        )
        u = User.objects.get(email="ana@test.com")
        assert u.organizacion is not None
        assert u.rol == User.Rol.TITULAR

@pytest.mark.django_db
class TestRegisterConOrganizacion:
    def setup_method(self):
        self.client = APIClient()
        self.url = reverse("register")

    def test_sin_codigo_crea_organizacion_y_queda_titular(self):
        payload = {
            "email": "ana@test.com",
            "password": "ClaveSegura123",
            "nombre": "Ana",
            "acepta_datos": True,
        }
        response = self.client.post(self.url, payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

        user = User.objects.get(email="ana@test.com")
        assert user.organizacion is not None
        assert user.rol == User.Rol.TITULAR
        assert user.organizacion.nombre == "Hogar de Ana"

    def test_con_codigo_valido_se_une_como_integrante(self):
        from app.models import Organizacion

        org = Organizacion.objects.create(nombre="Hogar de Familia")

        payload = {
            "email": "pedro@test.com",
            "password": "ClaveSegura123",
            "nombre": "Pedro",
            "acepta_datos": True,
            "codigo_organizacion": str(org.id),
        }
        response = self.client.post(self.url, payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

        user = User.objects.get(email="pedro@test.com")
        assert user.organizacion_id == org.id
        assert user.rol == User.Rol.INTEGRANTE

    def test_codigo_invalido_devuelve_400(self):
        payload = {
            "email": "malo@test.com",
            "password": "ClaveSegura123",
            "nombre": "Malo",
            "acepta_datos": True,
            "codigo_organizacion": "00000000-0000-0000-0000-000000000000",
        }
        response = self.client.post(self.url, payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "codigo_organizacion" in response.data
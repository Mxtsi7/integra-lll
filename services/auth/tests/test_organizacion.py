import jwt
import pytest
from django.conf import settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Organizacion, User


def _decode(token):
    """Verifica el token con el secreto del .env (JWT_SECRET)."""
    return jwt.decode(
        token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITMO]
    )


def _login_and_get_token(client, email, password):
    """Helper para loguear y obtener access_token."""
    resp = client.post(
        "/api/auth/login/",
        {"email": email, "password": password},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    return resp.data["access_token"]


@pytest.mark.django_db
class TestOrganizacionEndpoint:
    """Tests para GET /api/organizacion/ y GET /organizacion/"""

    def setup_method(self):
        self.client = APIClient()

    # ── Aislamiento entre organizaciones ─────────────────────────────

    def test_usuarios_de_diferentes_organizaciones_ven_sus_propias_datos(self):
        """Con dos usuarios de organizaciones distintas, cada GET /organizacion/
        debe devolver únicamente los datos propios, nunca los de la otra organización.
        """
        # Crear organización A con su titular y un integrante
        org_a = Organizacion.objects.create(nombre="Hogar Familia A")
        titular_a = User.objects.create_user(
            email="titular_a@test.com",
            password="ClaveSegura123",
            nombre="Titular A",
            organizacion=org_a,
            rol=User.Rol.TITULAR,
        )
        integrante_a = User.objects.create_user(
            email="integrante_a@test.com",
            password="ClaveSegura123",
            nombre="Integrante A",
            organizacion=org_a,
            rol=User.Rol.INTEGRANTE,
        )

        # Crear organización B con su titular
        org_b = Organizacion.objects.create(nombre="Hogar Familia B")
        titular_b = User.objects.create_user(
            email="titular_b@test.com",
            password="ClaveSegura123",
            nombre="Titular B",
            organizacion=org_b,
            rol=User.Rol.TITULAR,
        )

        # Login y obtener token del titular A
        token_a = _login_and_get_token(self.client, "titular_a@test.com", "ClaveSegura123")

        # Login y obtener token del titular B
        token_b = _login_and_get_token(self.client, "titular_b@test.com", "ClaveSegura123")

        # Titular A consulta su organización usando JWT
        r_a = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION=f"Bearer {token_a}",
        )
        assert r_a.status_code == status.HTTP_200_OK
        assert r_a.data["id"] == str(org_a.id)
        assert r_a.data["nombre"] == "Hogar Familia A"
        # Debe ver a ambos miembros de la org A
        assert len(r_a.data["miembros"]) == 2
        miembro_emails = {m["email"] for m in r_a.data["miembros"]}
        assert miembro_emails == {"titular_a@test.com", "integrante_a@test.com"}
        assert r_a.data["mi_rol"] == "titular"

        # Titular B consulta su organización usando JWT
        r_b = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION=f"Bearer {token_b}",
        )
        assert r_b.status_code == status.HTTP_200_OK
        assert r_b.data["id"] == str(org_b.id)
        assert r_b.data["nombre"] == "Hogar Familia B"
        # Debe ver solo a su miembro (titular_b)
        assert len(r_b.data["miembros"]) == 1
        assert r_b.data["miembros"][0]["email"] == "titular_b@test.com"
        assert r_b.data["mi_rol"] == "titular"

        # CRÍTICO: Titular A NO ve datos de la organización B
        assert r_a.data["id"] != str(org_b.id)
        assert r_a.data["nombre"] != "Hogar Familia B"
        for miembro in r_a.data["miembros"]:
            assert miembro["email"] != "titular_b@test.com"

    # ── Acceso mediante cabeceras del gateway (RF-26) ─────────────────

    def test_gateway_headers_devuelven_organizacion_correcta(self):
        """Cuando el gateway inyecta X-Usuario-Id, X-Organizacion-Id, X-Rol,
        el endpoint debe usar esas cabeceras sin validar JWT.
        """
        org = Organizacion.objects.create(nombre="Hogar Gateway")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )
        integrante = User.objects.create_user(
            email="integrante@test.com",
            password="ClaveSegura123",
            nombre="Integrante",
            organizacion=org,
            rol=User.Rol.INTEGRANTE,
        )

        # Simular petición que viene del gateway con cabeceras inyectadas
        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(titular.id),
            HTTP_X_ORGANIZACION_ID=str(org.id),
            HTTP_X_ROL=User.Rol.TITULAR,
        )

        assert r.status_code == status.HTTP_200_OK
        assert r.data["id"] == str(org.id)
        assert r.data["nombre"] == "Hogar Gateway"
        assert len(r.data["miembros"]) == 2
        assert r.data["mi_rol"] == "titular"

    def test_gateway_headers_con_rol_integrante_devuelve_integrante(self):
        """El rol viene de la cabecera X-Rol inyectada por el gateway."""
        org = Organizacion.objects.create(nombre="Hogar Gateway")
        integrante = User.objects.create_user(
            email="integrante@test.com",
            password="ClaveSegura123",
            nombre="Integrante",
            organizacion=org,
            rol=User.Rol.INTEGRANTE,
        )

        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(integrante.id),
            HTTP_X_ORGANIZACION_ID=str(org.id),
            HTTP_X_ROL=User.Rol.INTEGRANTE,
        )

        assert r.status_code == status.HTTP_200_OK
        assert r.data["mi_rol"] == "integrante"

    # ── Validación JWT directa (sin gateway) ──────────────────────────

    def test_jwt_directo_devuelve_organizacion_correcta(self):
        """Sin cabeceras de gateway, valida el JWT y extrae la organización."""
        org = Organizacion.objects.create(nombre="Hogar JWT Directo")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )

        token = _login_and_get_token(self.client, "titular@test.com", "ClaveSegura123")

        r = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        assert r.status_code == status.HTTP_200_OK
        assert r.data["id"] == str(org.id)
        assert r.data["nombre"] == "Hogar JWT Directo"
        assert len(r.data["miembros"]) == 1
        assert r.data["mi_rol"] == "titular"

    def test_jwt_sin_organizacion_devuelve_403(self):
        """Usuario sin organización recibe 403 (no hay org a la que pertenezca)."""
        user_sin_org = User.objects.create_user(
            email="sin-org@test.com",
            password="ClaveSegura123",
            nombre="Sin Org",
        )

        token = _login_and_get_token(self.client, "sin-org@test.com", "ClaveSegura123")

        r = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert "detail" in r.data

    def test_gateway_sin_organizacion_devuelve_403(self):
        """Cabeceras de gateway sin X-Organizacion-Id devuelven 403."""
        user = User.objects.create_user(
            email="test@test.com",
            password="ClaveSegura123",
            nombre="Test",
        )

        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(user.id),
            HTTP_X_ROL=User.Rol.TITULAR,
            # Sin X-Organizacion-Id
        )

        assert r.status_code == status.HTTP_403_FORBIDDEN

    # ── Validación de token ──────────────────────────────────────────

    def test_token_expirado_devuelve_401(self):
        """Token expirado debe devolver 401."""
        org = Organizacion.objects.create(nombre="Hogar Expirado")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )

        # Crear token expirado manualmente
        import time
        payload = {
            "user_id": str(titular.id),
            "organizacion_id": str(org.id),
            "rol": "titular",
            "exp": int(time.time()) - 3600,  # Expirado hace 1 hora
        }
        expired_token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)

        r = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION=f"Bearer {expired_token}",
        )

        assert r.status_code == status.HTTP_401_UNAUTHORIZED

    def test_token_invalido_devuelve_401(self):
        """Token con firma inválida debe devolver 401."""
        r = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION="Bearer token.invalido.firmado",
        )

        assert r.status_code == status.HTTP_401_UNAUTHORIZED

    def test_sin_autorizacion_devuelve_403(self):
        """Sin Authorization header ni cabeceras de gateway devuelve 403."""
        r = self.client.get(reverse("organizacion"))
        assert r.status_code == status.HTTP_403_FORBIDDEN

    # ── Estructura de respuesta ──────────────────────────────────────

    def test_respuesta_tiene_estructura_correcta(self):
        """Verificar que la respuesta tiene todos los campos esperados."""
        org = Organizacion.objects.create(nombre="Hogar Estructura")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )

        token = _login_and_get_token(self.client, "titular@test.com", "ClaveSegura123")

        r = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        assert r.status_code == status.HTTP_200_OK
        # Campos obligatorios
        assert "id" in r.data
        assert "nombre" in r.data
        assert "miembros" in r.data
        assert "mi_rol" in r.data
        # Tipos
        assert isinstance(r.data["id"], str)
        assert isinstance(r.data["nombre"], str)
        assert isinstance(r.data["miembros"], list)
        assert isinstance(r.data["mi_rol"], str)
        # Cada miembro tiene sus campos
        for miembro in r.data["miembros"]:
            assert "id" in miembro
            assert "nombre" in miembro
            assert "email" in miembro
            assert "rol" in miembro

    # ── Acceso por URL raíz (/organizacion/) ──────────────────────────

    def test_url_root_tambien_funciona(self):
        """La URL /organizacion/ (sin /api/) también funciona."""
        org = Organizacion.objects.create(nombre="Hogar Root")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )

        token = _login_and_get_token(self.client, "titular@test.com", "ClaveSegura123")

        r = self.client.get(
            reverse("organizacion-root"),
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        assert r.status_code == status.HTTP_200_OK
        assert r.data["id"] == str(org.id)
        assert r.data["nombre"] == "Hogar Root"

    # ── Miembros inactivos ────────────────────────────────────────────

    def test_miembros_inactivos_no_aparecen(self):
        """Usuarios is_active=False no deben aparecer en la lista de miembros."""
        org = Organizacion.objects.create(nombre="Hogar Activos")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )
        inactivo = User.objects.create_user(
            email="inactivo@test.com",
            password="ClaveSegura123",
            nombre="Inactivo",
            organizacion=org,
            rol=User.Rol.INTEGRANTE,
            is_active=False,
        )

        token = _login_and_get_token(self.client, "titular@test.com", "ClaveSegura123")

        r = self.client.get(
            reverse("organizacion"),
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        assert r.status_code == status.HTTP_200_OK
        assert len(r.data["miembros"]) == 1
        assert r.data["miembros"][0]["email"] == "titular@test.com"
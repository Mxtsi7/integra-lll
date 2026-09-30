import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Organizacion, User


@pytest.mark.django_db
class TestOrganizacionEndpoint:
    """Tests para GET /api/organizacion/

    El endpoint confía en las cabeceras inyectadas por el gateway (ADR-004):
    X-Usuario-Id, X-Organizacion-Id, X-Rol. NO valida JWT directamente.
    """

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

        # Simular petición del gateway para titular A
        r_a = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(titular_a.id),
            HTTP_X_ORGANIZACION_ID=str(org_a.id),
            HTTP_X_ROL=User.Rol.TITULAR,
        )
        assert r_a.status_code == status.HTTP_200_OK
        assert r_a.data["id"] == str(org_a.id)
        assert r_a.data["nombre"] == "Hogar Familia A"
        # Debe ver a ambos miembros de la org A
        assert len(r_a.data["miembros"]) == 2
        miembro_correos = {m["correo"] for m in r_a.data["miembros"]}
        assert miembro_correos == {"titular_a@test.com", "integrante_a@test.com"}
        assert r_a.data["mi_rol"] == "titular"

        # Simular petición del gateway para titular B
        r_b = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(titular_b.id),
            HTTP_X_ORGANIZACION_ID=str(org_b.id),
            HTTP_X_ROL=User.Rol.TITULAR,
        )
        assert r_b.status_code == status.HTTP_200_OK
        assert r_b.data["id"] == str(org_b.id)
        assert r_b.data["nombre"] == "Hogar Familia B"
        # Debe ver solo a su miembro (titular_b)
        assert len(r_b.data["miembros"]) == 1
        assert r_b.data["miembros"][0]["correo"] == "titular_b@test.com"
        assert r_b.data["mi_rol"] == "titular"

        # CRÍTICO: Titular A NO ve datos de la organización B
        assert r_a.data["id"] != str(org_b.id)
        assert r_a.data["nombre"] != "Hogar Familia B"
        for miembro in r_a.data["miembros"]:
            assert miembro["correo"] != "titular_b@test.com"

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

    def test_gateway_sin_usuario_devuelve_403(self):
        """Sin X-Usuario-Id devuelve 403."""
        org = Organizacion.objects.create(nombre="Hogar Test")
        user = User.objects.create_user(
            email="test@test.com",
            password="ClaveSegura123",
            nombre="Test",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )

        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_ORGANIZACION_ID=str(org.id),
            HTTP_X_ROL=User.Rol.TITULAR,
            # Sin X-Usuario-Id
        )

        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert "usuario" in r.data["detail"].lower()

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
        assert "organizacion" in r.data["detail"].lower()

    def test_gateway_usuario_no_pertenece_a_org_devuelve_403(self):
        """Si el usuario no pertenece a la organización indicada, devuelve 403."""
        org_a = Organizacion.objects.create(nombre="Org A")
        org_b = Organizacion.objects.create(nombre="Org B")
        user = User.objects.create_user(
            email="user@test.com",
            password="ClaveSegura123",
            nombre="User",
            organizacion=org_a,  # Usuario pertenece a Org A
            rol=User.Rol.TITULAR,
        )

        # Gateway inyecta X-Organizacion-Id de Org B pero usuario es de Org A
        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(user.id),
            HTTP_X_ORGANIZACION_ID=str(org_b.id),
            HTTP_X_ROL=User.Rol.TITULAR,
        )

        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert "pertenece" in r.data["detail"].lower()

    def test_gateway_organizacion_inexistente_devuelve_404(self):
        """Si X-Organizacion-Id no existe, devuelve 404 (get_object_or_404)."""
        user = User.objects.create_user(
            email="test@test.com",
            password="ClaveSegura123",
            nombre="Test",
        )

        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(user.id),
            HTTP_X_ORGANIZACION_ID="00000000-0000-0000-0000-000000000000",
            HTTP_X_ROL=User.Rol.TITULAR,
        )

        assert r.status_code == status.HTTP_404_NOT_FOUND

    # ── Validación de contexto (sin JWT) ──────────────────────────────

    def test_sin_cabeceras_devuelve_403(self):
        """Sin cabeceras de gateway devuelve 403."""
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
        integrante = User.objects.create_user(
            email="integrante@test.com",
            password="ClaveSegura123",
            nombre="Integrante",
            organizacion=org,
            rol=User.Rol.INTEGRANTE,
        )

        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(titular.id),
            HTTP_X_ORGANIZACION_ID=str(org.id),
            HTTP_X_ROL=User.Rol.TITULAR,
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
        # Cada miembro tiene sus campos (usa 'correo' no 'email')
        for miembro in r.data["miembros"]:
            assert "id" in miembro
            assert "nombre" in miembro
            assert "correo" in miembro  # Alineado con login y /api/usuarios/me/
            assert "rol" in miembro

    def test_respuesta_usa_correo_no_email(self):
        """El campo de email del miembro debe ser 'correo' (consistente con login y /me/)."""
        org = Organizacion.objects.create(nombre="Hogar Correo")
        titular = User.objects.create_user(
            email="titular@test.com",
            password="ClaveSegura123",
            nombre="Titular",
            organizacion=org,
            rol=User.Rol.TITULAR,
        )

        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(titular.id),
            HTTP_X_ORGANIZACION_ID=str(org.id),
            HTTP_X_ROL=User.Rol.TITULAR,
        )

        assert r.status_code == status.HTTP_200_OK
        for miembro in r.data["miembros"]:
            assert "correo" in miembro
            assert "email" not in miembro  # No debe venir 'email'
            assert miembro["correo"] == miembro.get("email", miembro["correo"])

    # ── Miembros inactivos ──────────────────────────────────────────────

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

        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(titular.id),
            HTTP_X_ORGANIZACION_ID=str(org.id),
            HTTP_X_ROL=User.Rol.TITULAR,
        )

        assert r.status_code == status.HTTP_200_OK
        assert len(r.data["miembros"]) == 1
        assert r.data["miembros"][0]["correo"] == "titular@test.com"

    # ── Fallback mi_rol desde BD ──────────────────────────────────────

    def test_mi_rol_fallback_desde_bd_si_falta_x_rol(self):
        """Si no viene X-Rol, usa el rol real del usuario en BD."""
        org = Organizacion.objects.create(nombre="Hogar Fallback")
        integrante = User.objects.create_user(
            email="integrante@test.com",
            password="ClaveSegura123",
            nombre="Integrante",
            organizacion=org,
            rol=User.Rol.INTEGRANTE,
        )

        # Simular gateway que NO inyecta X-Rol (caso raro)
        r = self.client.get(
            reverse("organizacion"),
            HTTP_X_USUARIO_ID=str(integrante.id),
            HTTP_X_ORGANIZACION_ID=str(org.id),
            # Sin HTTP_X_ROL
        )

        assert r.status_code == status.HTTP_200_OK
        assert r.data["mi_rol"] == "integrante"
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

    # ── Las que cubren lo que ya costó arreglar una vez ──────────────
    #
    # Estas cinco se perdieron al reescribir el archivo. Vuelven porque cada
    # una protege algo que se revirtió solo en alguna ronda de revisión.

    def test_el_token_se_valida_con_el_secreto_del_gateway(self, usuario):
        """El contrato del ADR-004: auth firma con JWT_SECRET y el gateway
        valida con el mismo. Si alguien lo cambia por SECRET_KEY, el gateway
        rechaza todos los tokens y esta prueba lo agarra antes."""
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        claims = _decode(resp.data["access_token"])

        assert claims["user_id"] == usuario.id
        assert claims["token_type"] == "access"
        assert "exp" in claims

    def test_login_con_el_correo_en_mayusculas(self, usuario):
        """El correo se guarda como se escribió, pero entrar no distingue caja
        (`get_by_natural_key` con `__iexact`). Ya se revirtió dos veces."""
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ANA@TEST.COM", "password": "ClaveSegura123"},
            format="json",
        )

        assert resp.status_code == 200

    def test_usuario_inactivo_no_puede_entrar(self, usuario):
        usuario.is_active = False
        usuario.save(update_fields=["is_active"])

        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "ClaveSegura123"},
            format="json",
        )

        assert resp.status_code == 401

    def test_payload_incompleto_es_400_y_no_401(self, usuario):
        """400 es "mandaste mal la petición" y 401 es "tus credenciales no
        sirven". Mezclarlos deja al formulario sin saber qué campo falló."""
        resp = APIClient().post(
            "/api/auth/login/", {"email": "ana@test.com"}, format="json"
        )

        assert resp.status_code == 400
        assert "password" in resp.data

    def test_correo_inexistente_responde_lo_mismo_que_clave_mala(self, usuario):
        """Mismo código y mismo mensaje en los dos casos: si difirieran, se
        podría averiguar qué correos están registrados."""
        cliente = APIClient()
        inexistente = cliente.post(
            "/api/auth/login/",
            {"email": "no-existe@test.com", "password": "ClaveSegura123"},
            format="json",
        )
        clave_mala = cliente.post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "otra-clave"},
            format="json",
        )

        assert inexistente.status_code == clave_mala.status_code == 401
        assert inexistente.data["detail"] == clave_mala.data["detail"]


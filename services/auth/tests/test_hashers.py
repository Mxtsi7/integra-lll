import pytest
from django.contrib.auth.hashers import (
    PBKDF2PasswordHasher,
    check_password,
    identify_hasher,
    make_password,
)
from django.test import override_settings
from rest_framework.test import APIClient

from app.models import Organizacion, User


def _iteraciones(hash_guardado):
    return int(hash_guardado.split("$")[1])


def test_por_defecto_usa_las_iteraciones_de_django(settings):
    # Sin PBKDF2_ITERACIONES (local, CI) nada cambia respecto de antes.
    assert settings.PBKDF2_ITERACIONES == PBKDF2PasswordHasher.iterations


@override_settings(PBKDF2_ITERACIONES=1000)
def test_las_iteraciones_salen_de_settings():
    hash_nuevo = make_password("ClaveSegura123")

    assert hash_nuevo.startswith("pbkdf2_sha256$1000$")
    assert check_password("ClaveSegura123", hash_nuevo)


@override_settings(PBKDF2_ITERACIONES=1000)
def test_un_hash_con_otras_iteraciones_se_verifica_y_pide_rehash():
    # Los usuarios que ya existen tienen el hash con las iteraciones de Django.
    viejo = PBKDF2PasswordHasher().encode("ClaveSegura123", "sal1234567890abc")

    assert check_password("ClaveSegura123", viejo)
    assert identify_hasher(viejo).must_update(viejo)


@pytest.mark.django_db
def test_el_login_re_hashea_con_las_iteraciones_configuradas():
    org = Organizacion.objects.create(nombre="Hogar de prueba")
    usuario = User.objects.create_user(
        email="ana@test.com",
        password="ClaveSegura123",
        nombre="Ana",
        organizacion=org,
        rol="titular",
    )
    assert _iteraciones(usuario.password) == PBKDF2PasswordHasher.iterations

    with override_settings(PBKDF2_ITERACIONES=1000):
        resp = APIClient().post(
            "/api/auth/login/",
            {"email": "ana@test.com", "password": "ClaveSegura123"},
            format="json",
        )

    assert resp.status_code == 200
    usuario.refresh_from_db()
    assert _iteraciones(usuario.password) == 1000

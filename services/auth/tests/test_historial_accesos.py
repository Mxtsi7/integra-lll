from datetime import timedelta

import pytest
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APIClient

from app.models import Organizacion, Sesion, User
from .test_contratos_openapi import validar


RUTA = "/api/usuarios/me/historial-accesos/"


@pytest.fixture
def usuario(db):
    return User.objects.create_user(
        email="historial@example.test", password="Historial123", nombre="Historial",
        organizacion=Organizacion.objects.create(nombre="Hogar"), rol=User.Rol.TITULAR,
    )


def cabeceras(usuario):
    return {
        "HTTP_X_USUARIO_ID": str(usuario.pk),
        "HTTP_X_ORGANIZACION_ID": str(usuario.organizacion_id),
    }


def test_login_registra_acceso_y_logout_lo_conserva(usuario):
    cliente = APIClient()
    cuerpo = {"email": usuario.email, "password": "incorrecta"}
    assert cliente.post("/api/auth/login/", cuerpo).status_code == 401
    assert cliente.get(RUTA, **cabeceras(usuario)).json() == {
        "resultados": [], "siguiente_offset": None,
    }

    cuerpo["password"] = "Historial123"
    login = cliente.post("/api/auth/login/", cuerpo)
    assert login.status_code == 200
    assert cliente.post("/api/auth/logout/", {"refresh_token": login.data["refresh_token"]}).status_code == 204
    respuesta = cliente.get(RUTA, **cabeceras(usuario))
    assert respuesta.status_code == 200
    assert "no-store" in respuesta["Cache-Control"]
    (acceso,) = respuesta.json()["resultados"]
    assert set(acceso) == {"iniciada_en", "metodo"}
    assert acceso["metodo"] == "local"
    assert acceso["iniciada_en"]
    validar(SchemaGenerator().get_schema(request=None, public=True), RUTA, "get", respuesta)


def test_historial_paginado_excluye_otro_usuario_y_sesiones_anteriores(usuario):
    otro = User.objects.create_user(
        email="otro-historial@example.test", nombre="Otro",
        organizacion=usuario.organizacion, rol=User.Rol.INTEGRANTE,
    )
    ahora = timezone.now()
    vence_en = ahora + timedelta(days=1)
    Sesion.objects.create(usuario=usuario, refresh_jti="legado", vence_en=vence_en)
    Sesion.objects.create(usuario=otro, refresh_jti="otro", vence_en=vence_en, iniciada_en=ahora)
    Sesion.objects.create(
        usuario=usuario, refresh_jti="anterior", vence_en=vence_en,
        iniciada_en=ahora - timedelta(hours=1), metodo=Sesion.Metodo.LOCAL,
    )
    Sesion.objects.create(
        usuario=usuario, refresh_jti="reciente", vence_en=vence_en,
        iniciada_en=ahora, metodo=Sesion.Metodo.GOOGLE,
    )

    cliente = APIClient()
    primera = cliente.get(RUTA, {"limit": 1, "usuario_id": otro.pk}, **cabeceras(usuario))
    assert primera.status_code == 200
    assert primera.json()["siguiente_offset"] == 1
    assert [acceso["metodo"] for acceso in primera.json()["resultados"]] == ["google"]
    segunda = cliente.get(RUTA, {"limit": 1, "offset": 1}, **cabeceras(usuario))
    assert segunda.status_code == 200
    assert segunda.json()["siguiente_offset"] is None
    assert [acceso["metodo"] for acceso in segunda.json()["resultados"]] == ["local"]


def test_historial_exige_contexto_valido_y_paginacion_valida(usuario):
    cliente = APIClient()
    assert cliente.get(RUTA).status_code == 403
    assert cliente.get(RUTA, HTTP_X_USUARIO_ID=str(usuario.pk)).status_code == 403
    assert cliente.get(RUTA, {"limit": 101}, **cabeceras(usuario)).status_code == 400
    assert cliente.get(RUTA, {"offset": -1}, **cabeceras(usuario)).status_code == 400

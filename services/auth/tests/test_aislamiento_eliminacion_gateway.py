"""MX-13: Gateway real + Auth real; solo el transporte HTTP tiene doble."""

import json
from types import SimpleNamespace
from urllib.parse import urlsplit

from django.test import RequestFactory
import jwt
import pytest
from rest_framework.test import APIClient

from app.models import Organizacion, User
from gateway.app import proxy

CLAVE = "ClaveSegura123"


@pytest.fixture(autouse=True)
def pbkdf2_de_prueba(settings):
    settings.PBKDF2_ITERACIONES = 1000


@pytest.fixture
def gateway(monkeypatch, settings):
    settings.RUTAS = {"/api/auth/": "auth", "/api/usuarios/": "auth", "/api/organizacion/": "auth"}
    settings.SERVICIOS = {"auth": "http://auth-interno.test"}
    settings.RUTAS_PUBLICAS = ("/api/auth/login/",)
    settings.TIEMPO_ESPERA_SEGUNDOS = 10
    llamadas = []

    def transporte(metodo, url, *, headers, data, **opciones):
        destino = urlsplit(url)
        assert destino.netloc == "auth-interno.test"
        llamadas.append({"metodo": metodo, "headers": headers.copy()})
        contexto = {f"HTTP_{nombre.upper().replace('-', '_')}": valor for nombre, valor in headers.items() if nombre.lower() != "content-type"}
        ruta = destino.path + (f"?{destino.query}" if destino.query else "")
        respuesta = APIClient().generic(metodo, ruta, data=data, content_type=headers.get("Content-Type", "application/json"), **contexto)
        return SimpleNamespace(status_code=respuesta.status_code, content=respuesta.content, headers=dict(respuesta.items()))

    monkeypatch.setattr(proxy.requests, "request", transporte)

    def enviar(metodo, ruta, *, token=None, cuerpo=None, headers=None):
        cabeceras = {**(headers or {})}
        if token:
            cabeceras["Authorization"] = f"Bearer {token}"
        solicitud = RequestFactory().generic(metodo, ruta, data=json.dumps(cuerpo or {}), content_type="application/json", headers=cabeceras)
        respuesta = proxy.reenviar(solicitud)
        respuesta.datos = json.loads(respuesta.content) if respuesta.content else None
        return respuesta

    enviar.llamadas = llamadas
    return enviar


@pytest.fixture
def cuentas(db, gateway):
    actores = []
    for letra in ("A", "B"):
        organizacion = Organizacion.objects.create(nombre=f"Hogar {letra}")
        User.objects.create_user(email=f"titular-{letra}@test.com", nombre=f"Titular {letra}", password=None, organizacion=organizacion, rol=User.Rol.TITULAR)
        usuario = User.objects.create_user(email=f"integrante-{letra}@test.com", nombre=f"Integrante {letra}", password=CLAVE, organizacion=organizacion, rol=User.Rol.INTEGRANTE)
        respuesta = gateway("POST", "/api/auth/login/", cuerpo={"email": usuario.email, "password": CLAVE})
        assert respuesta.status_code == 200
        actores.append((usuario, respuesta.datos["access_token"]))
    return actores


def cabeceras_falsas(usuario):
    return {"X-Usuario-Id": str(usuario.pk), "X-Organizacion-Id": str(usuario.organizacion_id), "X-Rol": "titular", "X-Sesion-Id": "00000000-0000-0000-0000-000000000000"}


@pytest.mark.django_db
@pytest.mark.parametrize("indice", [0, 1], ids=["A", "B"])
def test_delete_con_identidad_falsa_elimina_solo_al_sujeto_y_revoca_su_jwt(gateway, cuentas, indice):
    usuario, token = cuentas[indice]
    ajeno, token_ajeno = cuentas[1 - indice]
    respuesta = gateway("DELETE", "/api/usuarios/me/", token=token, headers=cabeceras_falsas(ajeno), cuerpo={"password": CLAVE, "confirmacion": "ELIMINAR", "usuario_id": ajeno.pk, "organizacion_id": str(ajeno.organizacion_id)})
    assert respuesta.status_code == 204
    assert not User.objects.filter(pk=usuario.pk).exists() and User.objects.filter(pk=ajeno.pk, is_active=True).exists()
    assert gateway("GET", "/api/usuarios/me/", token=token).status_code == 401
    assert gateway("GET", "/api/usuarios/me/", token=token_ajeno).status_code == 200


@pytest.mark.django_db
def test_delete_rechaza_pertenencia_modificada_sin_borrar_otra_organizacion(gateway, cuentas):
    usuario, token = cuentas[0]
    User.objects.filter(pk=usuario.pk).update(organizacion=cuentas[1][0].organizacion)
    respuesta = gateway("DELETE", "/api/usuarios/me/", token=token, cuerpo={"password": CLAVE, "confirmacion": "ELIMINAR"})
    assert respuesta.status_code == 404 and User.objects.count() == 4

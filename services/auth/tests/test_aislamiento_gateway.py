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
def test_lectura_propia_y_organizacion_descartan_identidad_falsa(gateway, cuentas, indice):
    usuario, token = cuentas[indice]
    ajeno = cuentas[1 - indice][0]
    me = gateway("GET", "/api/usuarios/me/", token=token, headers=cabeceras_falsas(ajeno))
    assert me.status_code == 200 and me.datos["id"] == usuario.pk
    detalle = gateway("GET", f"/api/usuarios/{usuario.pk}/", token=token, headers=cabeceras_falsas(ajeno))
    assert detalle.status_code == 200 and detalle.datos["email"] == usuario.email
    organizacion = gateway("GET", f"/api/organizacion/?organizacion_id={ajeno.organizacion_id}", token=token, headers=cabeceras_falsas(ajeno))
    assert organizacion.status_code == 200
    assert organizacion.datos["id"] == str(usuario.organizacion_id) and organizacion.datos["mi_rol"] == "integrante"
    assert {miembro["id"] for miembro in organizacion.datos["miembros"]} == set(User.objects.filter(organizacion_id=usuario.organizacion_id).values_list("pk", flat=True))
    cabeceras = gateway.llamadas[-1]["headers"]
    assert cabeceras["X-Usuario-Id"] == str(usuario.pk) and cabeceras["X-Rol"] == "integrante"
    assert cabeceras["X-Sesion-Id"] != "00000000-0000-0000-0000-000000000000"
    assert not any(nombre.lower() == "authorization" for nombre in cabeceras)


@pytest.mark.django_db
@pytest.mark.parametrize("indice", [0, 1], ids=["A", "B"])
@pytest.mark.parametrize("metodo,estado", [("GET", 404), ("PATCH", 405), ("DELETE", 405)])
def test_matriz_por_id_no_lee_ni_modifica_usuario_ajeno(gateway, cuentas, indice, metodo, estado):
    usuario, token = cuentas[indice]
    ajeno = cuentas[1 - indice][0]
    antes = list(User.objects.order_by("pk").values())
    respuesta = gateway(metodo, f"/api/usuarios/{ajeno.pk}/", token=token, headers=cabeceras_falsas(ajeno), cuerpo={"nombre": "Intruso", "password": CLAVE, "confirmacion": "ELIMINAR"})
    assert respuesta.status_code == estado
    assert list(User.objects.order_by("pk").values()) == antes
    assert ajeno.email.encode() not in respuesta.content


@pytest.mark.django_db
@pytest.mark.parametrize("indice", [0, 1], ids=["A", "B"])
def test_patch_con_headers_falsos_cambia_solo_el_nombre_propio(gateway, cuentas, indice):
    usuario, token = cuentas[indice]
    ajeno = cuentas[1 - indice][0]
    respuesta = gateway("PATCH", "/api/usuarios/me/", token=token, headers=cabeceras_falsas(ajeno), cuerpo={"nombre": "Actualizado"})
    assert respuesta.status_code == 200 and respuesta.datos["id"] == usuario.pk
    usuario.refresh_from_db()
    ajeno.refresh_from_db()
    assert usuario.nombre == "Actualizado" and ajeno.nombre != "Actualizado"
    assert usuario.rol == "integrante" and usuario.organizacion_id != ajeno.organizacion_id
    ataque = gateway("PATCH", "/api/usuarios/me/", token=token, cuerpo={"nombre": "Intruso", "id": ajeno.pk, "rol": "titular", "organizacion_id": str(ajeno.organizacion_id)})
    assert ataque.status_code == 400
    usuario.refresh_from_db()
    assert usuario.nombre == "Actualizado" and usuario.rol == "integrante"


@pytest.mark.django_db
@pytest.mark.parametrize("campo", ["user_id", "organizacion_id", "rol"])
def test_claim_alterado_no_llega_a_auth(gateway, cuentas, campo):
    usuario, token = cuentas[0]
    ajeno = cuentas[1][0]
    claims = jwt.decode(token, options={"verify_signature": False})
    claims[campo] = {"user_id": ajeno.pk, "organizacion_id": str(ajeno.organizacion_id), "rol": "titular"}[campo]
    falsificado = jwt.encode(claims, "clave-distinta-para-ataque-de-prueba", algorithm="HS256")
    llamadas = len(gateway.llamadas)
    respuesta = gateway("PATCH", "/api/usuarios/me/", token=falsificado, cuerpo={"nombre": "Intruso"})
    assert respuesta.status_code == 401 and len(gateway.llamadas) == llamadas
    usuario.refresh_from_db()
    ajeno.refresh_from_db()
    assert usuario.nombre == "Integrante A" and ajeno.nombre == "Integrante B"


@pytest.mark.django_db
@pytest.mark.parametrize("metodo,ruta,estado", [("GET", "/api/usuarios/me/", 404), ("PATCH", "/api/usuarios/me/", 404), ("GET", "/api/usuarios/{id}/", 404), ("GET", "/api/organizacion/", 403)])
def test_usuario_inactivo_no_accede_aunque_su_jwt_siga_firmado(gateway, cuentas, metodo, ruta, estado):
    usuario, token = cuentas[0]
    User.objects.filter(pk=usuario.pk).update(is_active=False)
    respuesta = gateway(metodo, ruta.format(id=usuario.pk), token=token, cuerpo={"nombre": "Intruso"})
    assert respuesta.status_code == estado
    usuario.refresh_from_db()
    assert usuario.nombre == "Integrante A" and not usuario.is_active


@pytest.mark.django_db
@pytest.mark.parametrize("metodo,ruta", [("GET", "/api/usuarios/me/"), ("PATCH", "/api/usuarios/me/"), ("GET", "/api/usuarios/{id}/"), ("GET", "/api/organizacion/")])
def test_pertenencia_modificada_invalida_contexto_anterior(gateway, cuentas, metodo, ruta):
    usuario, token = cuentas[0]
    User.objects.filter(pk=usuario.pk).update(organizacion=cuentas[1][0].organizacion)
    respuesta = gateway(metodo, ruta.format(id=usuario.pk), token=token, cuerpo={"nombre": "Intruso"})
    assert respuesta.status_code == 403
    usuario.refresh_from_db()
    assert usuario.nombre == "Integrante A"


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

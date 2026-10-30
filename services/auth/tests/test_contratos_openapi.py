"""MX-14: valida respuestas ejecutadas y detecta deriva del contrato publicado."""
import ast
import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest
from drf_spectacular.generators import SchemaGenerator
from jsonschema import Draft7Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7
from rest_framework.test import APIClient

from app.models import User
from app.openapi import RUTAS_PUBLICAS

RAIZ = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def esquema():
    return SchemaGenerator().get_schema(request=None, public=True)


def compatible_jsonschema(valor):
    if isinstance(valor, list):
        return [compatible_jsonschema(v) for v in valor]
    if not isinstance(valor, dict):
        return valor
    valor = {k: compatible_jsonschema(v) for k, v in valor.items()}
    if "$ref" in valor and valor["$ref"].startswith("#"):
        valor["$ref"] = "urn:contrato-auth" + valor["$ref"]
    if valor.pop("nullable", False):
        return {"anyOf": [valor, {"type": "null"}]}
    return valor


def validar(esquema, ruta, metodo, respuesta):
    contrato = compatible_jsonschema(deepcopy(esquema))
    salida = contrato["paths"][ruta][metodo]["responses"][str(respuesta.status_code)]
    if respuesta.status_code == 204:
        assert "content" not in salida
        assert respuesta.content == b""
        return
    schema = salida["content"]["application/json"]["schema"]
    registry = Registry().with_resource("urn:contrato-auth", Resource.from_contents(contrato, default_specification=DRAFT7))
    Draft7Validator(schema, registry=registry).validate(respuesta.json())


def test_snapshot_y_tipos_estan_actualizados(esquema):
    assert json.loads((RAIZ / "docs/api/auth.openapi.json").read_text(encoding="utf-8")) == esquema
    subprocess.run([sys.executable, str(RAIZ / "scripts/generar-tipos-auth.py"), "--check"], check=True)


def test_delete_publica_cuerpo_obligatorio_y_password_solo_de_entrada(esquema):
    operacion = esquema["paths"]["/api/usuarios/me/"]["delete"]
    cuerpo = operacion.get("requestBody")
    assert cuerpo is not None, "DELETE requiere password y confirmacion, pero OpenAPI omite el cuerpo"
    assert cuerpo["required"] is True
    referencia = cuerpo["content"]["application/json"]["schema"]["$ref"]
    nombre = referencia.rsplit("/", 1)[-1]
    assert nombre == "EliminarCuentaRequest"
    entrada = esquema["components"]["schemas"][nombre]
    assert set(entrada["required"]) == {"password", "confirmacion"}
    assert entrada["properties"]["password"]["writeOnly"] is True
    confirmacion = entrada["properties"]["confirmacion_organizacion"]
    assert "último titular" in confirmacion["description"].lower()
    assert "password" not in esquema["components"]["schemas"]["EliminacionAceptada"]["properties"]
    assert "content" not in operacion["responses"]["204"]


def test_publicas_coinciden_con_gateway_y_el_contexto_no_lo_decide_cliente(esquema):
    arbol = ast.parse((RAIZ / "gateway/config/settings.py").read_text(encoding="utf-8"))
    asignacion = next(n for n in arbol.body if isinstance(n, ast.Assign) and
                      any(isinstance(t, ast.Name) and t.id == "RUTAS_PUBLICAS" for t in n.targets))
    assert set(ast.literal_eval(asignacion.value)) == RUTAS_PUBLICAS
    for ruta, operaciones in esquema["paths"].items():
        if not ruta.startswith("/api/") or ruta == "/api/schema/":
            continue
        for operacion in operaciones.values():
            assert operacion["security"] == ([] if ruta in RUTAS_PUBLICAS else [{"GatewayBearer": []}])
            assert not any(p.get("in") == "header" and p["name"].lower() in
                           {"x-usuario-id", "x-organizacion-id", "x-rol"} for p in operacion.get("parameters", []))


@pytest.mark.django_db
def test_login_refresh_logout_y_perfil_nulo_coinciden_con_esquema(esquema):
    user = User.objects.create_user(email="contrato@example.com", password="DemoClave123", nombre="Contrato")
    cliente = APIClient()
    login = cliente.post("/api/auth/login/", {"email": user.email, "password": "DemoClave123"}, format="json")
    assert login.status_code == 200
    validar(esquema, "/api/auth/login/", "post", login)
    perfil = cliente.get("/api/usuarios/me/", HTTP_X_USUARIO_ID=str(user.pk))
    assert perfil.status_code == 200
    assert perfil.json()["organizacion_id"] is None
    validar(esquema, "/api/usuarios/me/", "get", perfil)
    refresh = cliente.post("/api/auth/refresh/", {"refresh_token": login.json()["refresh_token"]}, format="json")
    assert refresh.status_code == 200
    validar(esquema, "/api/auth/refresh/", "post", refresh)
    logout = cliente.post("/api/auth/logout/", {"refresh_token": refresh.json()["refresh_token"]}, format="json")
    assert logout.status_code == 204
    validar(esquema, "/api/auth/logout/", "post", logout)


@pytest.mark.django_db
@pytest.mark.parametrize("ruta,cuerpo,codigo", [
    ("/api/auth/login/", {}, 400),
    ("/api/auth/password-reset/", {"email": "ausente@example.com"}, 200),
    ("/api/auth/password-reset/confirm/", {"token": "invalido", "password": "DemoClave123"}, 400),
    ("/api/auth/email-verification/confirm/", {"token": "invalido"}, 400),
    ("/api/auth/refresh/", {"refresh_token": "invalido"}, 401),
])
def test_mensajes_y_errores_reales_coinciden_con_esquema(esquema, ruta, cuerpo, codigo):
    respuesta = APIClient().post(ruta, cuerpo, format="json")
    assert respuesta.status_code == codigo
    validar(esquema, ruta, "post", respuesta)


@pytest.mark.django_db
def test_eliminacion_202_documenta_operacion_asincrona(esquema):
    from app.models import Organizacion
    org = Organizacion.objects.create(nombre="Demo contrato")
    user = User.objects.create_user(email="eliminar@example.com", password="DemoClave123", nombre="Demo", organizacion=org, rol="titular")
    respuesta = APIClient().delete("/api/usuarios/me/", {
        "password": "DemoClave123", "confirmacion": "ELIMINAR", "confirmacion_organizacion": "ELIMINAR",
    }, format="json", HTTP_X_USUARIO_ID=str(user.pk), HTTP_X_ORGANIZACION_ID=str(org.pk))
    assert respuesta.status_code == 202
    validar(esquema, "/api/usuarios/me/", "delete", respuesta)


@pytest.mark.django_db
@pytest.mark.parametrize("ultimo_titular,cuerpo,codigo", [
    (True, None, 400),
    (True, {"password": "DemoClave123", "confirmacion": "ELIMINAR"}, 409),
    (False, {"password": "DemoClave123", "confirmacion": "ELIMINAR"}, 204),
])
def test_delete_contrato_cubre_cuerpo_ausente_confirmacion_condicional_y_204(esquema, ultimo_titular, cuerpo, codigo):
    from app.models import Organizacion
    org = Organizacion.objects.create(nombre="Contrato DELETE") if ultimo_titular else None
    user = User.objects.create_user(email="contrato-delete@example.com", password="DemoClave123", nombre="Demo",
                                    organizacion=org, rol="titular" if ultimo_titular else None)
    cabeceras = {"HTTP_X_USUARIO_ID": str(user.pk)}
    if org:
        cabeceras["HTTP_X_ORGANIZACION_ID"] = str(org.pk)
    respuesta = APIClient().delete("/api/usuarios/me/", cuerpo, format="json", **cabeceras)
    assert respuesta.status_code == codigo
    validar(esquema, "/api/usuarios/me/", "delete", respuesta)
    if codigo == 400:
        assert set(respuesta.json()) == {"password", "confirmacion"}
    if codigo == 409:
        assert respuesta.json()["code"] == "confirmacion_organizacion_requerida"
    assert User.objects.filter(pk=user.pk).exists() is (codigo != 204)

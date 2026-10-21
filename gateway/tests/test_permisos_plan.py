import json
from unittest.mock import Mock
import pytest
import requests
from django.test import Client
from app import proxy
from tests.test_gateway import token, con_token


@pytest.fixture
def transporte(monkeypatch):
    def respuesta(datos):
        r = requests.Response()
        r.status_code = 200
        r._content = json.dumps(datos).encode()
        r.headers["Content-Type"] = "application/json"
        return r
    permiso = respuesta({"plan": "free", "features": {"asistente_financiero": False, "recomendaciones_automaticas": False}})
    destino = respuesta({"resultado": "dominio"})
    peticion = Mock(side_effect=lambda metodo, url, **kw: permiso if url.endswith("/me/permisos/") else destino)
    monkeypatch.setattr(proxy.requests, "request", peticion)
    return peticion, permiso


@pytest.mark.parametrize("ruta", ["/api/asistente/", "/api/recomendaciones/", "/api/recomendaciones/123/explicar/"])
def test_free_directo_no_llega_a_analytics(transporte, ruta):
    peticion, _ = transporte
    r = Client().get(ruta, **con_token(token(plan="premium")), HTTP_X_PLAN="premium", HTTP_X_FEATURES="todo")
    assert r.status_code == 403
    assert peticion.call_count == 1
    cabeceras = peticion.call_args.kwargs["headers"]
    assert "X-Plan" not in cabeceras and "X-Features" not in cabeceras
    assert cabeceras["X-Correlation-ID"] == r["X-Correlation-ID"]


def test_premium_consulta_auth_y_luego_el_dominio(transporte):
    peticion, permiso = transporte
    permiso._content = b'{"plan":"premium","features":{"asistente_financiero":true}}'
    assert Client().post("/api/asistente/", data="{}", content_type="application/json", **con_token(token())).status_code == 200
    assert peticion.call_count == 2
    assert peticion.call_args.kwargs["data"] == b"{}"


@pytest.mark.parametrize("falso", [None, [], {"plan": "premium", "features": {"asistente_financiero": "true"}}, {"plan": "inventado", "features": {"asistente_financiero": True}}])
def test_permiso_invalido_degrada_sin_dar_acceso(transporte, falso):
    peticion, permiso = transporte
    permiso._content = json.dumps(falso).encode()
    assert Client().get("/api/asistente/", **con_token(token())).status_code == 503
    assert peticion.call_count == 1


def test_auth_caido_no_autoriza_por_claim(transporte):
    peticion, _ = transporte
    peticion.side_effect = requests.Timeout()
    assert Client().get("/api/asistente/", **con_token(token(plan="premium"))).status_code == 503
    assert peticion.call_count == 1

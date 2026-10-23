"""Gateway/Auth/PostgreSQL reales; transporte HTTP y dominio Analytics simulados."""
import json
import time
from urllib.parse import urlsplit
from uuid import uuid4
import pytest
import requests
from django.test import RequestFactory
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient
from gateway.app import proxy
from app.models import Contratacion, EventoPago, Organizacion, User
from app.pagos_eventos import firma_pago
from tests.test_contratacion import cuenta, contexto, evento

pytestmark = pytest.mark.django_db


@pytest.fixture
def gateway(monkeypatch, settings):
    settings.RUTAS = {"/api/auth/": "auth", "/api/usuarios/": "auth", "/api/contrataciones/": "auth",
        "/api/pagos/": "auth", "/api/planes/": "auth", "/api/asistente/": "analytics", "/api/recomendaciones/": "analytics"}
    settings.SERVICIOS = {"auth": "http://auth-interno.test", "analytics": "http://analytics-interno.test"}
    settings.RUTAS_PUBLICAS = ("/api/auth/login/", "/api/pagos/webhook/", "/api/pagos/mock/")
    settings.TIEMPO_ESPERA_SEGUNDOS = 10
    llamadas = []
    def transporte(metodo, url, *, headers, data=b"", **opciones):
        destino = urlsplit(url)
        llamadas.append(destino.netloc)
        respuesta = requests.Response()
        if destino.netloc == "analytics-interno.test":
            respuesta.status_code, respuesta._content = 200, b'{"dominio_simulado":true}'
            return respuesta
        assert destino.netloc == "auth-interno.test"
        cabeceras = {f"HTTP_{k.upper().replace('-', '_')}": v for k, v in headers.items() if k.lower() != "content-type"}
        ruta = destino.path + ("?" + destino.query if destino.query else "")
        auth = APIClient().generic(metodo, ruta, data=data, content_type=headers.get("Content-Type", "application/json"), **cabeceras)
        respuesta.status_code, respuesta._content, respuesta.headers = auth.status_code, auth.content, dict(auth.items())
        return respuesta
    monkeypatch.setattr(proxy.requests, "request", transporte)
    def enviar(metodo, ruta, *, token=None, datos=None, headers=None):
        cabeceras = dict(headers or {})
        if token:
            cabeceras["Authorization"] = "Bearer " + token
        solicitud = RequestFactory().generic(metodo, ruta, data=json.dumps(datos or {}), content_type="application/json", headers=cabeceras)
        r = proxy.reenviar(solicitud)
        r.datos = json.loads(r.content) if r.content else None
        return r
    enviar.llamadas = llamadas
    return enviar


def login(gateway, usuario):
    r = gateway("POST", "/api/auth/login/", datos={"email": usuario.email, "password": "Clave123"})
    assert r.status_code == 200
    return r.datos["access_token"]


def pagar(gateway, datos):
    instante = str(int(time.time()))
    firma = firma_pago(json.dumps(datos).encode(), instante)
    return gateway("POST", "/api/pagos/webhook/", datos=datos, headers={"X-Pagos-Firma": firma, "X-Pagos-Instante": instante})


@pytest.mark.parametrize("resultado", ["exitosa", "fallida", "cancelada"])
def test_estado_sincroniza_permisos_sin_refrescar_jwt(gateway, cuenta, resultado):
    token = login(gateway, cuenta)
    antes = gateway("GET", "/api/usuarios/me/permisos/", token=token)
    assert antes["Cache-Control"] == "no-store"
    assert antes.datos["features"]["asistente_financiero"] is False
    assert gateway("GET", "/api/asistente/", token=token, headers={"X-Plan": "premium", "X-Features": "todo"}).status_code == 403
    clave = str(uuid4())
    inicio = gateway("POST", "/api/contrataciones/", token=token, datos={"plan_codigo": "premium", "clave_idempotencia": clave})
    assert inicio.status_code == 201 and inicio.datos["permisos"]["plan"] == "free"
    contrato = Contratacion.objects.get(pk=inicio.datos["id"])
    # Un supuesto retorno del navegador no confirma el pago.
    retorno = gateway("GET", f"/api/contrataciones/{contrato.pk}/?resultado=exitosa", token=token)
    assert retorno.datos["permisos"]["plan"] == "free"
    datos = evento(contrato, estado=resultado)
    confirmacion = pagar(gateway, datos)
    assert confirmacion.status_code == 200
    esperado = resultado == "exitosa"
    assert confirmacion.datos["permisos"]["features"]["asistente_financiero"] is esperado
    assert pagar(gateway, datos).datos["repetido"] is True
    permisos = gateway("GET", "/api/usuarios/me/permisos/", token=token)
    assert permisos.datos == confirmacion.datos["permisos"]
    assert gateway("GET", "/api/usuarios/me/", token=token).datos["plan"] == permisos.datos["plan"]
    assert gateway("GET", "/api/asistente/", token=token).status_code == (200 if esperado else 403)
    assert gateway("GET", "/api/recomendaciones/", token=token).status_code == (200 if esperado else 403)
    assert EventoPago.objects.count() == 1


def test_cancelar_y_vencer_no_deja_features_guardadas(gateway, cuenta):
    token = login(gateway, cuenta)
    inicio = gateway("POST", "/api/contrataciones/", token=token, datos={"plan_codigo": "premium", "clave_idempotencia": str(uuid4())})
    contrato = Contratacion.objects.get(pk=inicio.datos["id"])
    assert pagar(gateway, evento(contrato)).status_code == 200
    assert gateway("GET", "/api/asistente/", token=token).status_code == 200
    cancelacion = gateway("POST", f"/api/contrataciones/{contrato.pk}/cancelar/", token=token)
    assert cancelacion.datos["permisos"]["plan"] == "premium"
    ahora = timezone.now()
    Contratacion.objects.filter(pk=contrato.pk).update(vigente_desde=ahora-timedelta(days=30), vigente_hasta=ahora-timedelta(seconds=1))
    assert gateway("GET", "/api/usuarios/me/", token=token)["Cache-Control"] == "no-store"
    assert gateway("GET", "/api/usuarios/me/permisos/", token=token).datos["plan"] == "free"
    assert gateway("GET", "/api/asistente/", token=token).status_code == 403


def test_pago_de_a_no_habilita_b_ni_admite_evento_cruzado(gateway, cuenta):
    otro = User.objects.create_user(email="b@example.test", nombre="B", password="Clave123", rol="titular", organizacion=Organizacion.objects.create(nombre="B"))
    ta, tb = login(gateway, cuenta), login(gateway, otro)
    contratos = []
    for t in (ta, tb):
        r = gateway("POST", "/api/contrataciones/", token=t, datos={"plan_codigo": "premium", "clave_idempotencia": str(uuid4())})
        contratos.append(Contratacion.objects.get(pk=r.datos["id"]))
    datos = evento(contratos[0])
    assert pagar(gateway, datos).status_code == 200
    assert gateway("GET", "/api/asistente/", token=ta).status_code == 200
    assert gateway("GET", "/api/asistente/", token=tb, headers={"X-Organizacion-Id": str(cuenta.organizacion_id), "X-Plan": "premium"}).status_code == 403
    assert gateway("GET", f"/api/contrataciones/{contratos[0].pk}/", token=tb).status_code == 404
    assert pagar(gateway, evento(contratos[1], evento_id=datos["evento_id"])).status_code == 409
    assert pagar(gateway, evento(contratos[1], organizacion_id=str(cuenta.organizacion_id))).status_code == 400
    assert gateway("GET", "/api/usuarios/me/permisos/", token=tb).datos["plan"] == "free"


def test_payload_no_concede_plan_y_contexto_obsoleto_no_usa_permiso_anterior(gateway, cuenta):
    token = login(gateway, cuenta)
    assert gateway("PATCH", "/api/usuarios/me/", token=token, datos={"nombre": "Demo", "features": {"asistente_financiero": True}}).status_code == 400
    User.objects.filter(pk=cuenta.pk).update(organizacion=Organizacion.objects.create(nombre="Cambio"))
    assert gateway("GET", "/api/asistente/", token=token).status_code == 403
    assert "analytics-interno.test" not in gateway.llamadas

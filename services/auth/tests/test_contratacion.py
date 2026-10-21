from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import time
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4
import pytest
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient
from app.models import Contratacion, EventoPago, Organizacion, Plan, User
from app.pagos_eventos import firma_pago

pytestmark = pytest.mark.django_db
SECRETO = "secreto-exclusivo-pruebas-pagos-no-produccion"


@pytest.fixture
def cuenta(settings):
    settings.PBKDF2_ITERACIONES = 1000
    settings.PAGOS_MOCK_HABILITADO = True
    settings.PAGOS_WEBHOOK_SECRET = SECRETO
    for codigo, precio in [("free", "0.00"), ("premium", "4990.00")]:
        Plan.objects.get_or_create(codigo=codigo, defaults={"nombre": codigo, "precio": precio})
    org = Organizacion.objects.create(nombre="Organización demo")
    return User.objects.create_user(email="pago@example.test", password="Clave123", nombre="Titular", rol="titular", organizacion=org)


def contexto(usuario):
    return {"HTTP_X_USUARIO_ID": str(usuario.pk), "HTTP_X_ORGANIZACION_ID": str(usuario.organizacion_id)}


def iniciar(usuario, clave=None, **extra):
    return APIClient().post("/api/contrataciones/", {"plan_codigo": "premium", "clave_idempotencia": str(clave or uuid4()), **extra}, format="json", **contexto(usuario))


def evento(contrato, **cambios):
    return {"evento_id": str(uuid4()), "contratacion_id": str(contrato.pk), "organizacion_id": str(contrato.organizacion_id), "importe": str(contrato.importe), "moneda": contrato.moneda, "estado": "exitosa", **cambios}


def webhook(datos, *, instante=None, firma=None):
    cuerpo = json.dumps(datos).encode()
    instante = str(instante if instante is not None else int(time.time()))
    return APIClient().post("/api/pagos/webhook/", cuerpo, content_type="application/json", HTTP_X_PAGOS_FIRMA=firma or firma_pago(cuerpo, instante), HTTP_X_PAGOS_INSTANTE=instante)


def test_inicio_es_idempotente_y_no_concede_plan(cuenta):
    clave = uuid4()
    primera, repetida = iniciar(cuenta, clave), iniciar(cuenta, clave)
    assert primera.status_code == 201 and repetida.status_code == 200
    assert primera.data["id"] == repetida.data["id"]
    assert primera.data["importe"] == "4990.00" and primera.data["precio_demo"]
    assert Contratacion.objects.count() == 1
    assert iniciar(cuenta).status_code == 409
    cliente = APIClient()
    enlace = urlsplit(primera.data["url_checkout"])
    assert cliente.get(enlace.path + "?" + enlace.query).status_code == 200
    assert cliente.get("/api/usuarios/me/", **contexto(cuenta)).data["plan"] == "free"
    assert not EventoPago.objects.exists()


@pytest.mark.parametrize("extra", [{"importe": "0.01"}, {"organizacion_id": str(uuid4())}, {"estado": "exitosa"}, {"url_retorno": "https://ajeno.test/"}])
def test_navegador_no_fija_importe_estado_tenant_ni_retorno(cuenta, extra):
    assert iniciar(cuenta, **extra).status_code == 400
    assert not Contratacion.objects.exists()


def test_integrante_y_tenant_ajeno_no_contratan(cuenta):
    cuenta.rol = "integrante"
    cuenta.save(update_fields=["rol"])
    assert iniciar(cuenta).status_code == 403
    cuenta.rol = "titular"
    cuenta.save(update_fields=["rol"])
    contrato = Contratacion.objects.get(pk=iniciar(cuenta).data["id"])
    otra = User.objects.create_user(email="otra@example.test", nombre="Otra", password="Clave123", rol="titular", organizacion=Organizacion.objects.create(nombre="Otra"))
    assert APIClient().get(f"/api/contrataciones/{contrato.pk}/", **contexto(otra)).status_code == 404
    assert APIClient().post(f"/api/contrataciones/{contrato.pk}/cancelar/", **contexto(otra)).status_code == 404


@pytest.mark.parametrize("habilitado,secreto", [(False, SECRETO), (True, "")])
def test_mock_requiere_bandera_y_secreto(cuenta, settings, habilitado, secreto):
    settings.PAGOS_MOCK_HABILITADO, settings.PAGOS_WEBHOOK_SECRET = habilitado, secreto
    assert iniciar(cuenta).status_code == 503
    assert not Contratacion.objects.exists()


@pytest.mark.parametrize("url", ["https://ajeno.test/#fragmento", "http://no-local.test/", "javascript:alert(1)"])
def test_mala_configuracion_de_retorno_revierte_intencion(cuenta, settings, url):
    settings.PAGOS_URL_RETORNO = url
    assert iniciar(cuenta).status_code == 503
    assert not Contratacion.objects.exists()


def test_webhook_duplicado_y_fuera_de_orden_no_extiende_ni_reactiva(cuenta):
    contrato = Contratacion.objects.get(pk=iniciar(cuenta).data["id"])
    pago = evento(contrato)
    assert webhook(pago).status_code == 200
    contrato.refresh_from_db()
    fin = contrato.vigente_hasta
    assert webhook(pago).data["repetido"] is True
    assert webhook(evento(contrato, estado="fallida")).data["aplicado"] is False
    contrato.refresh_from_db()
    assert contrato.estado == "exitosa" and contrato.vigente_hasta == fin
    assert APIClient().post(f"/api/contrataciones/{contrato.pk}/cancelar/", **contexto(cuenta)).status_code == 200
    assert webhook(evento(contrato)).data["aplicado"] is False
    assert APIClient().get("/api/usuarios/me/", **contexto(cuenta)).data["plan"] == "premium"
    Contratacion.objects.filter(pk=contrato.pk).update(vigente_hasta=timezone.now() - timedelta(seconds=1), vigente_desde=timezone.now() - timedelta(days=30))
    assert APIClient().get("/api/usuarios/me/", **contexto(cuenta)).data["plan"] == "free"


@pytest.mark.parametrize("cambio", [{"importe": "0.01"}, {"moneda": "USD"}, {"organizacion_id": str(uuid4())}, {"estado": "premium"}])
def test_webhook_no_acepta_evento_incoherente(cuenta, cambio):
    contrato = Contratacion.objects.get(pk=iniciar(cuenta).data["id"])
    assert webhook(evento(contrato, **cambio)).status_code == 400
    contrato.refresh_from_db()
    assert contrato.estado == "pendiente" and not EventoPago.objects.exists()


def test_firma_falsa_caducidad_y_evento_reutilizado(cuenta):
    contrato = Contratacion.objects.get(pk=iniciar(cuenta).data["id"])
    datos = evento(contrato)
    assert webhook(datos, firma="falsa").status_code == 403
    assert webhook(datos, instante=int(time.time()) - 301).status_code == 403
    assert not EventoPago.objects.exists()
    assert webhook(datos).status_code == 200
    assert webhook({**datos, "estado": "cancelada"}).status_code == 409
    contrato.refresh_from_db()
    assert contrato.estado == "exitosa"


@pytest.mark.parametrize("datos", [[], None, "texto", 42])
def test_json_sin_objeto_es_400(cuenta, datos):
    assert webhook(datos).status_code == 400
    assert not EventoPago.objects.exists()


def test_checkout_mock_ejecutable_confirma_por_la_misma_validacion(cuenta):
    datos = iniciar(cuenta).data
    token = parse_qs(urlsplit(datos["url_checkout"]).query)["token"][0]
    r = APIClient().post("/api/pagos/mock/", {"token": token, "estado": "exitosa"})
    assert r.status_code == 303 and r["Location"] == datos["url_retorno"]
    assert EventoPago.objects.count() == 1
    assert APIClient().get("/api/usuarios/me/", **contexto(cuenta)).data["plan"] == "premium"
    assert APIClient().get("/api/pagos/mock/?token=invalido").status_code == 403


def test_reintento_conserva_cotizacion_y_precio_real_no_usa_mock(cuenta):
    clave = uuid4()
    primera = iniciar(cuenta, clave)
    Plan.objects.filter(pk="premium").update(precio="9999.00")
    assert iniciar(cuenta, clave).data["importe"] == primera.data["importe"] == "4990.00"
    APIClient().post(f'/api/contrataciones/{primera.data["id"]}/cancelar/', **contexto(cuenta))
    Plan.objects.filter(pk="premium").update(precio_demo=False)
    assert iniciar(cuenta).status_code == 503


@pytest.mark.django_db(transaction=True)
def test_inicio_y_webhook_concurrentes_no_duplican(cuenta):
    clave = uuid4()
    def empezar(_):
        close_old_connections()
        try:
            return iniciar(cuenta, clave).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(empezar, range(2))) == [200, 201]
    contrato = Contratacion.objects.get()
    datos = evento(contrato)
    def confirmar(_):
        close_old_connections()
        try:
            return webhook(datos).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(confirmar, range(2))) == [200, 200]
    assert Contratacion.objects.count() == EventoPago.objects.count() == 1

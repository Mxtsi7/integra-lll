"""S3-FE-21 — la consulta interna de destinatarios que usa notifications.

    GET /internal/organizaciones/<organizacion_id>/destinatarios/

Se firma con `shared.directorio` (lo mismo que usa notifications) y se
verifica acá. Las pruebas de notifications usan un doble con la forma de la
respuesta de ESTA vista; `test_la_respuesta_tiene_la_forma_del_contrato` es
la que ata los dos lados.
"""

import time
import uuid

import pytest
from rest_framework.test import APIClient

from app.models import Organizacion, User
from shared import directorio

pytestmark = pytest.mark.django_db

SECRETO = "secreto-del-directorio-solo-prueba"


@pytest.fixture(autouse=True)
def secreto(monkeypatch):
    monkeypatch.setenv(directorio.VARIABLE_SECRETO, SECRETO)


@pytest.fixture
def hogar():
    org = Organizacion.objects.create(nombre="Hogar A")
    otra = Organizacion.objects.create(nombre="Hogar B")
    ana = User.objects.create_user("ana@ejemplo.cl", "x", nombre="Ana", organizacion=org, rol="titular")
    beto = User.objects.create_user("beto@ejemplo.cl", "x", nombre="Beto", organizacion=org, rol="integrante")
    User.objects.create_user("inactiva@ejemplo.cl", "x", nombre="Ex", organizacion=org, is_active=False)
    User.objects.create_user("de-otra@ejemplo.cl", "x", nombre="Otra", organizacion=otra)
    User.objects.create_user("sin-hogar@ejemplo.cl", "x", nombre="Sola")
    return org, otra, ana, beto


def pedir(organizacion_id, cabeceras=None):
    return APIClient().get(directorio.ruta(organizacion_id), headers=cabeceras or {})


def firmadas(organizacion_id, **extra):
    return directorio.cabeceras_directorio(organizacion_id, **extra)


def test_entrega_las_personas_activas_de_esa_organizacion(hogar):
    org, _, ana, beto = hogar

    respuesta = pedir(org.pk, firmadas(org.pk))

    assert respuesta.status_code == 200
    assert respuesta.json() == {"destinatarios": [
        {"usuario_id": str(ana.pk), "email": "ana@ejemplo.cl"},
        {"usuario_id": str(beto.pk), "email": "beto@ejemplo.cl"},
    ]}


def test_la_respuesta_tiene_la_forma_del_contrato(hogar):
    """Solo esas dos claves, y `usuario_id` como texto: es el valor de
    `X-Usuario-Id`, que es lo que guarda notifications."""
    org, *_ = hogar
    (primera, *_) = pedir(org.pk, firmadas(org.pk)).json()["destinatarios"]
    assert set(primera) == {"usuario_id", "email"}
    assert isinstance(primera["usuario_id"], str) and primera["usuario_id"].isdigit()


def test_una_organizacion_sin_personas_da_una_lista_vacia():
    org = uuid.uuid4()
    respuesta = pedir(org, firmadas(org))
    assert (respuesta.status_code, respuesta.json()) == (200, {"destinatarios": []})


def test_sin_firma_no_entrega_nada(hogar):
    org, *_ = hogar
    respuesta = pedir(org.pk)
    assert respuesta.status_code == 403
    assert "destinatarios" not in respuesta.json()


def test_la_firma_de_otra_organizacion_no_sirve(hogar):
    org, otra, *_ = hogar
    assert pedir(org.pk, firmadas(otra.pk)).status_code == 403


def test_una_firma_vencida_no_sirve(hogar):
    org, *_ = hogar
    vieja = firmadas(org.pk, ahora=time.time() - directorio.VIGENCIA_SEGUNDOS - 5)
    assert pedir(org.pk, vieja).status_code == 403


def test_una_firma_con_otro_secreto_no_sirve(hogar, monkeypatch):
    org, *_ = hogar
    monkeypatch.setenv(directorio.VARIABLE_SECRETO, "otro-secreto")
    ajena = firmadas(org.pk)
    monkeypatch.setenv(directorio.VARIABLE_SECRETO, SECRETO)
    assert pedir(org.pk, ajena).status_code == 403


def test_sin_secreto_configurado_auth_no_acepta_nada(hogar, monkeypatch):
    """Un auth mal configurado no puede quedar abierto: firmar con el secreto
    vacío no es posible, y verificar sin secreto rechaza."""
    org, *_ = hogar
    cabeceras = firmadas(org.pk)
    monkeypatch.delenv(directorio.VARIABLE_SECRETO)
    assert pedir(org.pk, cabeceras).status_code == 403
    with pytest.raises(ValueError):
        firmadas(org.pk)


def test_sin_secreto_en_auth_una_firma_con_clave_vacia_no_sirve(hogar, monkeypatch):
    """El ataque si auth quedara sin secreto: firmar con la clave vacía."""
    import hashlib
    import hmac

    org, *_ = hogar
    monkeypatch.delenv(directorio.VARIABLE_SECRETO)
    instante = str(int(time.time()))
    firma = hmac.new(b"", f"directorio:{org.pk}:{instante}".encode(), hashlib.sha256).hexdigest()
    cabeceras = {directorio.CABECERA_INSTANTE: instante, directorio.CABECERA_FIRMA: firma}
    assert pedir(org.pk, cabeceras).status_code == 403


@pytest.mark.parametrize("instante", ["", "abc", "1e9", "-5", "١٢٣"])
def test_un_instante_raro_no_sirve(hogar, instante):
    org, *_ = hogar
    cabeceras = firmadas(org.pk)
    cabeceras[directorio.CABECERA_INSTANTE] = instante
    assert pedir(org.pk, cabeceras).status_code == 403


def test_no_esta_bajo_api_y_no_sale_en_el_esquema(hogar):
    """El gateway solo enruta `/api/…`: esta ruta no se alcanza desde afuera."""
    org, *_ = hogar
    assert not directorio.ruta(org.pk).startswith("/api/")
    esquema = APIClient().get("/api/schema/", HTTP_ACCEPT="application/json").content.decode()
    assert "destinatarios" not in esquema


def test_no_la_corta_el_limite_por_ip(hogar):
    """notifications la consulta varias veces por corrida. Hoy auth no tiene
    límite global; si se agrega uno, esta vista tiene que quedar fuera."""
    org, *_ = hogar
    for _ in range(40):
        assert pedir(org.pk, firmadas(org.pk)).status_code == 200

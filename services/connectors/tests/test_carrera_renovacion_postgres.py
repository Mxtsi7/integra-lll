"""S3-FE-19 — dos workers con el mismo token vencido, a la vez.

Microsoft ROTA el token de refresco: si dos workers refrescan con el mismo,
el segundo puede recibir `invalid_grant` y la cuenta terminaría pidiendo una
reconexión que nadie necesitaba. Lo que lo evita es que el refresco tome la
fila con `select_for_update` y vuelva a mirar el vencimiento con el candado.

Aquí se prueba con dos conexiones de verdad: el primero se queda a mitad del
refresco (con la fila tomada) y el segundo tiene que esperar y, al entrar, ver
que ya no hace falta. SQLite bloquea la base entera y no puede mostrarlo.
"""

from datetime import timedelta
import threading
import uuid

import pytest
from django.db import connection, connections
from django.utils import timezone

from connectors import proveedores
from connectors.models import CuentaConectada
from connectors.renovacion import token_vigente

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
ESPERA = 15.0
MARGEN_DE_BLOQUEO = 2.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


class _Respuesta:
    status_code = 200

    def __init__(self, cuerpo):
        self._cuerpo = cuerpo

    def json(self):
        return self._cuerpo


@pytest.mark.django_db(transaction=True)
def test_dos_workers_refrescan_una_sola_vez(solo_postgres, claves, monkeypatch, settings):
    settings.OAUTH_CREDENCIALES = {"outlook": {"client_id": "c", "client_secret": "s"}}
    cuenta = CuentaConectada.objects.create(
        organizacion_id=ORG, proveedor="outlook", cuenta_externa="p@outlook.com",
        access_token="EwB-viejo", refresh_token="M.C1-viejo", token_expira_en=timezone.now() - timedelta(minutes=1),
    )
    refrescos = []
    primero_en_el_proveedor = threading.Event()
    soltar_al_primero = threading.Event()

    def post(url, data=None, timeout=None):
        refrescos.append(data["refresh_token"])
        if threading.current_thread().name == "primero":
            primero_en_el_proveedor.set()
            assert soltar_al_primero.wait(ESPERA), "nadie soltó al primero"
        return _Respuesta({"access_token": f"EwB-nuevo-{len(refrescos)}", "refresh_token": f"M.C1-rotado-{len(refrescos)}",
                           "expires_in": 3600})

    monkeypatch.setattr(proveedores.requests, "post", post)
    errores = []

    def trabajo():
        try:
            token_vigente(organizacion_id=ORG, cuenta_id=cuenta.pk, proveedor="outlook")
        except BaseException as exc:  # noqa: BLE001
            errores.append(exc)
        finally:
            connections.close_all()

    primero = threading.Thread(target=trabajo, name="primero", daemon=True)
    primero.start()
    assert primero_en_el_proveedor.wait(ESPERA)

    segundo = threading.Thread(target=trabajo, name="segundo", daemon=True)
    segundo.start()
    segundo.join(MARGEN_DE_BLOQUEO)
    assert segundo.is_alive(), "el segundo no esperó la fila: refrescó sin ver al primero"

    soltar_al_primero.set()
    primero.join(ESPERA)
    segundo.join(ESPERA)
    assert not primero.is_alive() and not segundo.is_alive()
    assert errores == []

    assert refrescos == ["M.C1-viejo"]
    cuenta.refresh_from_db()
    assert (cuenta.access_token, cuenta.refresh_token) == ("EwB-nuevo-1", "M.C1-rotado-1")

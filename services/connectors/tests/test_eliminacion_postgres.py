"""
MX-07 — una revocación ya confirmada sobrevive a que se caiga la conexión de
la limpieza, con dos conexiones a PostgreSQL de verdad.

`test_eliminacion.py` simula el fallo con una excepción del doble. Esto es la
reproducción de la revisión de la PR: el doble de Google confirma A y B, y
mientras la limpieza "habla" de B, OTRA conexión termina la de la petición con
`pg_terminate_backend`. Lo que Google ya confirmó para A tiene que quedar
confirmado en la base; si no, el reintento le manda un token revocado y recibe
400 para siempre.

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma: el commit de A no existiría. Solo contra
PostgreSQL.
"""

import threading
import time
import uuid
from types import SimpleNamespace

import pytest
from django.db import InterfaceError, OperationalError, connection, connections

from connectors import proveedores
from connectors.models import CuentaConectada
from tests.test_eliminacion import limpiar

ESPERA = 15.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


def terminar_desde_otra_conexion(pid):
    """Termina el backend `pid` desde otra conexión y espera a que desaparezca."""
    errores = []

    def trabajo():
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT pg_terminate_backend(%s)", [pid])
                limite = time.monotonic() + ESPERA
                while time.monotonic() < limite:
                    cursor.execute("SELECT 1 FROM pg_stat_activity WHERE pid = %s", [pid])
                    if cursor.fetchone() is None:
                        return
                    time.sleep(0.05)
                errores.append(f"el backend {pid} sigue vivo")
        except BaseException as exc:  # noqa: BLE001 — se informa en el principal
            errores.append(exc)
        finally:
            connections.close_all()

    hilo = threading.Thread(target=trabajo, name="terminador", daemon=True)
    hilo.start()
    hilo.join(ESPERA)
    assert not hilo.is_alive() and not errores, errores


@pytest.mark.django_db(transaction=True)
def test_conexion_terminada_con_b_conserva_la_revocacion_de_a(solo_postgres, monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuentas = {
        f"ya29.{letra}": CuentaConectada.objects.create(
            organizacion_id=org, proveedor="gmail",
            cuenta_externa=f"{letra.lower()}@gmail.com", access_token=f"ya29.{letra}",
        )
        for letra in "AB"
    }
    enviados = []

    def post(url, *, data, timeout):
        # Google confirma las dos; mientras confirma la segunda, otra
        # conexión termina la de la petición.
        enviados.append(data["token"])
        if len(enviados) == 2:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                pid = cursor.fetchone()[0]
            terminar_desde_otra_conexion(pid)
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(proveedores.requests, "post", post)
    with pytest.raises((OperationalError, InterfaceError)):
        limpiar(org)
    connection.close()

    assert len(enviados) == 2
    confirmada, interrumpida = (cuentas[token] for token in enviados)
    confirmada.refresh_from_db()
    assert confirmada.revocado_en is not None, "se perdió una revocación que Google ya confirmó"
    assert confirmada.access_token is None
    assert confirmada.estado == CuentaConectada.Estado.DESCONECTADA
    interrumpida.refresh_from_db()
    assert interrumpida.revocado_en is None
    assert str(interrumpida.access_token) == enviados[1]
    assert interrumpida.estado == CuentaConectada.Estado.CONECTADA

    # El reintento solo le manda a Google la que faltaba y termina.
    pendiente = enviados[1]
    enviados.clear()
    monkeypatch.setattr(
        proveedores.requests, "post",
        lambda url, *, data, timeout: enviados.append(data["token"]) or SimpleNamespace(status_code=200),
    )
    assert limpiar(org).status_code == 204
    assert enviados == [pendiente]
    assert not CuentaConectada.objects.filter(organizacion_id=org).exists()

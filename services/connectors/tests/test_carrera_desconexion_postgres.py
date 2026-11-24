"""S3-FE-20 — desconectar mientras una lectura guarda su página.

`test_lectura_programada_s3_fe_18_20.py` prueba la desconexión que llega
ANTES de guardar (la página no se guarda). Esto prueba la que llega MIENTRAS
se guarda, con dos conexiones de verdad: la lectura tiene tomada la fila de
la cuenta (`select_for_update`), así que la desconexión espera a que termine.
Lo guardado es de antes de desconectar, y la cuenta queda desconectada
después. SQLite bloquea la base entera y no puede mostrarlo.
"""

from datetime import datetime, timedelta, timezone as tz
import threading
import uuid

import pytest
from django.db import connection, connections
from django.utils import timezone

from connectors import candidatos_correo, lectura_programada
from connectors.lectura_correo import MensajeCorreo, PaginaDeMensajes
from connectors.lectura_programada import leer_cuenta
from connectors.models import CobroCandidato, CuentaConectada

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
ESPERA = 15.0
MARGEN_DE_BLOQUEO = 2.0
RECIBIDO = datetime(2026, 10, 2, 13, 30, tzinfo=tz.utc)
RECIBO = "Hola, gracias por tu pago.\nFecha de cobro: 1 de octubre de 2026\nTotal: CLP 9.990\n"


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


class Hilo(threading.Thread):
    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.error = None
        self.resultado = None

    def run(self):
        try:
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connections.close_all()

    def exigir_que_termino(self):
        self.join(ESPERA)
        assert not self.is_alive(), f"el hilo {self.name} se quedó colgado"
        if self.error is not None:
            raise self.error


class Lector:
    PROVEEDOR = "gmail"

    def __init__(self, cuenta):
        self.cuenta = cuenta

    def leer_mensajes(self, *, organizacion_id, cuenta_id, filtro=None, pagina=None, limite=25):
        mensaje = MensajeCorreo(
            cuenta_id=self.cuenta.pk, id_mensaje="m1", id_hilo="", recibido_en=RECIBIDO,
            remitente="Netflix <info@account.netflix.com>", asunto="Tu recibo de Netflix", texto=RECIBO,
            proveedor_correo="gmail", message_id="m1@correo.example.test",
        )
        return PaginaDeMensajes((mensaje,), None)


@pytest.mark.django_db(transaction=True)
def test_la_desconexion_espera_a_que_termine_de_guardar(solo_postgres, claves, monkeypatch):
    cuenta = CuentaConectada.objects.create(
        organizacion_id=ORG, proveedor="gmail", cuenta_externa="p@gmail.com",
        access_token="ya29.token", refresh_token="1//refresco",
        token_expira_en=timezone.now() + timedelta(minutes=50),
    )
    monkeypatch.setitem(lectura_programada.LECTORES, "gmail", Lector(cuenta))

    guardando = threading.Event()
    soltar = threading.Event()
    real = candidatos_correo.guardar_pagina

    def guardar_y_esperar(importacion, pagina, **extra):
        resultado = real(importacion, pagina, **extra)
        guardando.set()
        assert soltar.wait(ESPERA), "nadie soltó a la lectura"
        return resultado

    monkeypatch.setattr(lectura_programada, "guardar_pagina", guardar_y_esperar)

    lectura = Hilo("lectura", lambda: leer_cuenta(cuenta.pk))
    lectura.start()
    assert guardando.wait(ESPERA), "la lectura no llegó a guardar"

    desconexion = Hilo("desconexion", lambda: CuentaConectada.objects.filter(pk=cuenta.pk).update(
        estado=CuentaConectada.Estado.DESCONECTADA))
    desconexion.start()
    desconexion.join(MARGEN_DE_BLOQUEO)
    assert desconexion.is_alive(), "la desconexión no esperó: la lectura guardaba sin tener tomada la cuenta"

    soltar.set()
    lectura.exigir_que_termino()
    desconexion.exigir_que_termino()

    assert CobroCandidato.objects.count() == 1
    cuenta.refresh_from_db()
    assert cuenta.estado == CuentaConectada.Estado.DESCONECTADA
    # La próxima tarea ya no lee.
    assert leer_cuenta(cuenta.pk) == {"omitida": "no_conectada"}

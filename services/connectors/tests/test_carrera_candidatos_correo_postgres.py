"""S3-FE-09 — guardar candidatos de correo a la vez, con dos conexiones a PostgreSQL.

`test_candidatos_correo_s3_fe_09.py` guarda de a una página. Esto prueba las
dos carreras que pueden pasar de verdad con dos workers:

1. **El mismo correo en dos lecturas.** Un recibo con copia a dos buzones de
   la misma organización, o el solape entre dos corridas (S3-FE-03), lo traen
   dos veces. Lo sostiene la unicidad de S3-FE-17: el segundo `INSERT` espera
   a que el primero confirme y entonces no inserta nada.
2. **Dos páginas de la misma importación.** Los contadores y la lista de
   errores son leer-modificar-escribir sobre la fila de la importación. Sin
   tomarla, el segundo leería los valores de antes del primero y, al escribir,
   borraría lo del primero.

── Cómo se vuelve determinístico ───────────────────────────────────────────
No hay `sleep` que decida nada. El hilo A se detiene justo después de
insertar, con su transacción abierta, y no sigue hasta que la prueba lo
suelte. Mientras A está detenido, B tiene que aparecer ESPERANDO en
`pg_locks` (`granted = false`), y no haber terminado. Después se suelta a A
y se mira lo que quedó.

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma, y la otra conexión no vería nada. SQLite
bloquea la base entera y no puede mostrar esto.
"""

import threading
import time
import uuid
from datetime import datetime, timezone as tz

import pytest
from django.db import connection, connections

from connectors.candidatos_correo import guardar_pagina
from connectors.lectura_correo import MensajeCorreo, PaginaDeMensajes
from connectors.models import CobroCandidato, CuentaConectada, Importacion

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
ESPERA = 15.0
RECIBO = "Gracias por tu pago.\nFecha de cobro: 1 de octubre de 2026\nTotal: CLP 9.990"
DUDOSO = "Total: $9.990\nFecha: 2026-10-01"


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


@pytest.fixture(autouse=True)
def _claves(claves):
    """Las cuentas guardan su token cifrado (FE-06)."""


class Hilo(threading.Thread):
    """Un worker con su propia conexión. Anota su pid de PostgreSQL antes de
    empezar, para poder buscarlo en `pg_locks`."""

    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.pid = None
        self.tiene_pid = threading.Event()
        self.resultado = None
        self.error = None

    def run(self):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                self.pid = cursor.fetchone()[0]
            self.tiene_pid.set()
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            self.tiene_pid.set()
            connections.close_all()

    def exigir_que_termino(self):
        self.join(ESPERA)
        assert not self.is_alive(), f"el hilo {self.name} se quedó colgado"
        if self.error is not None:
            raise self.error


def esperando_un_bloqueo(pid) -> bool:
    """¿La sesión `pid` está esperando un bloqueo que otra tiene?"""
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM pg_locks WHERE pid = %s AND NOT granted", [pid])
        return cursor.fetchone()[0] > 0


def exigir_que_espera(hilo):
    """B tiene que quedar esperando en `pg_locks`, no terminar antes."""
    assert hilo.tiene_pid.wait(ESPERA), "B no arrancó"
    limite = time.monotonic() + ESPERA
    while time.monotonic() < limite:
        if esperando_un_bloqueo(hilo.pid):
            assert hilo.is_alive()
            return
        if not hilo.is_alive():
            pytest.fail(f"B terminó sin esperar a A (error: {hilo.error!r}): escribió sin ver lo de A")
        time.sleep(0.02)
    pytest.fail(f"pasaron {ESPERA:.0f} s y B no apareció esperando en pg_locks")


def detener_a_despues_de_insertar(monkeypatch):
    """A inserta y se queda con la transacción abierta hasta que lo suelten."""
    inserto = threading.Event()
    puede_seguir = threading.Event()
    real = CobroCandidato.objects.bulk_create

    def insertar_y_esperar(filas, **extra):
        creadas = real(filas, **extra)
        if threading.current_thread().name == "A":
            inserto.set()
            assert puede_seguir.wait(ESPERA), "nadie soltó a A"
        return creadas

    monkeypatch.setattr(CobroCandidato.objects, "bulk_create", insertar_y_esperar)
    return inserto, puede_seguir


def crear_cuenta(proveedor, correo):
    return CuentaConectada.objects.create(
        organizacion_id=ORG, proveedor=proveedor, cuenta_externa=correo, access_token="ya29.token",
        estado=CuentaConectada.Estado.CONECTADA,
    )


def crear_importacion(cuenta):
    return Importacion.objects.create(
        organizacion_id=ORG, usuario_id="42", origen=Importacion.Origen.CORREO, cuenta=cuenta,
        estado=Importacion.Estado.PROCESANDO,
    )


def mensaje(cuenta, *, id_mensaje, message_id=None, texto=RECIBO):
    return MensajeCorreo(
        cuenta_id=cuenta.pk, id_mensaje=id_mensaje, id_hilo="", recibido_en=datetime(2026, 10, 2, tzinfo=tz.utc),
        remitente="Netflix <info@account.netflix.com>", asunto="Tu recibo de Netflix", texto=texto,
        proveedor_correo=cuenta.proveedor, message_id=message_id or f"{id_mensaje}@correo.example.test",
    )


def pagina(*mensajes):
    return PaginaDeMensajes(mensajes=tuple(mensajes), siguiente_pagina=None)


@pytest.mark.django_db(transaction=True)
def test_el_mismo_correo_en_dos_lecturas_a_la_vez_deja_un_candidato(solo_postgres, monkeypatch):
    """A y B leen el mismo recibo desde dos buzones de la organización. B
    espera el `INSERT` de A; cuando A confirma, B no inserta el suyo."""
    gmail = crear_cuenta("gmail", "persona@gmail.com")
    outlook = crear_cuenta("outlook", "persona@empresa.cl")
    de_gmail = crear_importacion(gmail)
    de_outlook = crear_importacion(outlook)
    inserto, puede_seguir = detener_a_despues_de_insertar(monkeypatch)

    a = Hilo("A", lambda: guardar_pagina(de_gmail, pagina(
        mensaje(gmail, id_mensaje="18c2", message_id="recibo-1@netflix.com"))))
    b = Hilo("B", lambda: guardar_pagina(de_outlook, pagina(
        mensaje(outlook, id_mensaje="AAMkAGUAAAwTW09AAA=", message_id="recibo-1@netflix.com"))))
    try:
        a.start()
        assert inserto.wait(ESPERA), "A no llegó a insertar"
        b.start()
        exigir_que_espera(b)
    finally:
        puede_seguir.set()
    a.exigir_que_termino()
    b.exigir_que_termino()

    (candidato,) = CobroCandidato.objects.all()
    assert candidato.importacion_id == de_gmail.pk
    de_outlook.refresh_from_db()
    assert de_outlook.candidatos_detectados == 0
    assert (b.resultado.candidatos_nuevos, b.resultado.ya_guardados) == (0, 1)


@pytest.mark.django_db(transaction=True)
def test_dos_paginas_de_la_misma_importacion_a_la_vez_no_se_pisan(solo_postgres, monkeypatch):
    """A guarda la página 1 y se detiene antes de escribir los contadores. B,
    con la página 2, tiene que esperar la importación: si no, leería los
    contadores de antes de A y al escribir borraría lo de A."""
    gmail = crear_cuenta("gmail", "persona@gmail.com")
    importacion = crear_importacion(gmail)
    para_a = Importacion.objects.get(pk=importacion.pk)
    para_b = Importacion.objects.get(pk=importacion.pk)
    inserto, puede_seguir = detener_a_despues_de_insertar(monkeypatch)

    a = Hilo("A", lambda: guardar_pagina(para_a, pagina(
        mensaje(gmail, id_mensaje="p1"), mensaje(gmail, id_mensaje="p1-dudoso", texto=DUDOSO))))
    b = Hilo("B", lambda: guardar_pagina(para_b, pagina(
        mensaje(gmail, id_mensaje="p2"), mensaje(gmail, id_mensaje="p2-dudoso", texto=DUDOSO))))
    try:
        a.start()
        assert inserto.wait(ESPERA), "A no llegó a insertar"
        b.start()
        exigir_que_espera(b)
    finally:
        puede_seguir.set()
    a.exigir_que_termino()
    b.exigir_que_termino()

    importacion.refresh_from_db()
    assert (importacion.filas_procesadas, importacion.candidatos_detectados, importacion.errores_totales) == (4, 2, 2)
    assert sorted(error["mensaje"].count("«Tu recibo de Netflix»") for error in importacion.errores) == [1, 1]
    assert len({error["identificador_origen"] for error in importacion.errores}) == 2

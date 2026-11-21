"""S3-FE-03 / S3-FE-05 — dos workers con la misma cuenta, con dos conexiones
a PostgreSQL de verdad.

`test_avance_lectura_s3_fe_03_05.py` prueba la DECISIÓN con una conexión: qué
hace `leer_siguiente_lote` cuando el cursor ya cambió. La revisión de #189
anotó que eso intercala operaciones en una sola conexión y no demuestra el
MECANISMO. Esto es eso: dos workers, cada uno en su hilo y con su conexión,
coordinados por eventos y sin un `sleep` que decida nada.

── Los dos intercalados ───────────────────────────────────────────────────

    1. A y B leen el MISMO cursor. A toma la fila y, con ella tomada, está
       procesando. B termina de leer y quiere tomarla.
           Esperado: B ESPERA la fila (se ve en `pg_locks`, `granted =
           false`) y no procesa nada mientras tanto. Cuando A confirma, B ve
           que el cursor cambió y descarta su página: la página se procesó
           UNA vez.

    2. A está procesando con la fila tomada y B recién empieza.
           Esperado: B espera la fila YA al leer el cursor y, cuando A
           confirma, sigue desde la página que dejó A, no desde la de A.

Sin el `select_for_update` de antes de procesar, en (1) B procesa la misma
página que A. Sin el del principio, en (2) B lee el cursor viejo, pide otra
vez la primera página y la termina descartando.

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma, y la otra conexión no vería nada. Solo
contra PostgreSQL: SQLite bloquea la base entera y no puede mostrarlo.
"""

import threading
import time
import uuid
from datetime import datetime, timedelta, timezone as tz

import pytest
from django.db import connection, connections
from django.utils import timezone

from connectors.avance_lectura import leer_siguiente_lote
from connectors.lectura_correo import MensajeCorreo, PaginaDeMensajes
from connectors.models import AvanceDeLectura, CuentaConectada

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
LUNES = datetime(2026, 11, 16, 12, 0, tzinfo=tz.utc)

#: Cuánto se espera a que un hilo llegue a su punto de encuentro. Generoso: si
#: se agota es que algo no pasó, no que el equipo esté lento.
ESPERA = 15.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


class Hilo(threading.Thread):
    """Un worker con su propia conexión, que guarda su resultado o su error."""

    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.resultado = None
        self.error = None

    def run(self):
        try:
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            # Cada hilo tiene SU conexión (Django las guarda por hilo). Si
            # quedara abierta, el vaciado de tablas del final esperaría.
            connections.close_all()


def _pid_propio() -> int:
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_backend_pid()")
        return cursor.fetchone()[0]


def _esperando_un_bloqueo(pid) -> bool:
    """¿La sesión `pid` está esperando un bloqueo que no tiene? Se mira desde
    la conexión principal."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM pg_locks WHERE pid = %s AND NOT granted", [pid])
        return cursor.fetchone()[0] > 0


def _otro_espera_un_bloqueo(*, que_no_es) -> bool:
    """¿Alguna sesión, que no sea `que_no_es` ni la principal, espera un
    bloqueo? Para B antes de que se sepa su conexión."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_locks WHERE NOT granted AND pid <> %s AND pid <> pg_backend_pid()",
            [que_no_es],
        )
        return cursor.fetchone()[0] > 0


def _hasta_que(condicion, *, descripcion, salvo_que):
    """Sondea `condicion` hasta que sea verdadera; falla con nombre si no.
    `salvo_que` corta al tiro: si B ya terminó, no va a ponerse a esperar."""
    limite = time.monotonic() + ESPERA
    while time.monotonic() < limite:
        if condicion():
            return
        if salvo_que():
            pytest.fail(f"no pasó que {descripcion}: B terminó sin esperar")
        time.sleep(0.02)
    pytest.fail(f"pasaron {ESPERA:.0f} s y no: {descripcion}")


def mensaje(cuenta, n):
    return MensajeCorreo(
        cuenta_id=cuenta.pk, id_mensaje=f"m{n}", id_hilo="", recibido_en=LUNES - timedelta(hours=n),
        remitente="Netflix <info@netflix.com>", asunto="Tu recibo", texto="", proveedor_correo="gmail",
        message_id=f"m{n}@netflix.com",
    )


class LectorCoordinado:
    """Un lector de prueba que entrega la página de cada cursor y, en los
    hilos que se le digan, se detiene "hablando con el proveedor" hasta que
    lo suelten. Anota qué cursor pidió cada hilo y con qué conexión."""

    PROVEEDOR = "gmail"

    def __init__(self, paginas, *, detener=()):
        self.paginas = paginas
        self.pedidos = []
        self.pids = {}
        self.leyendo = {nombre: threading.Event() for nombre in detener}
        self.puede_volver = {nombre: threading.Event() for nombre in detener}

    def leer_mensajes(self, *, organizacion_id, cuenta_id, filtro=None, pagina=None, limite=25):
        nombre = threading.current_thread().name
        self.pedidos.append((nombre, pagina))
        self.pids[nombre] = _pid_propio()
        if nombre in self.leyendo:
            self.leyendo[nombre].set()
            assert self.puede_volver[nombre].wait(ESPERA), f"nadie soltó a {nombre} en el proveedor"
        return self.paginas[pagina]


class ProcesarCoordinado:
    """`procesar` que anota quién procesó qué y, en el hilo que se le diga, se
    detiene con la fila tomada hasta que lo suelten."""

    def __init__(self, *, detener):
        self.lotes = []
        self.detener = detener
        self.procesando = threading.Event()
        self.soltar = threading.Event()

    def __call__(self, lote):
        nombre = threading.current_thread().name
        self.lotes.append((nombre, [m.id_mensaje for m in lote.mensajes]))
        if nombre == self.detener:
            self.procesando.set()
            assert self.soltar.wait(ESPERA), f"nadie soltó a {nombre} mientras procesaba"

    def de(self, nombre):
        return [ids for quien, ids in self.lotes if quien == nombre]


def cuenta():
    return CuentaConectada.objects.create(
        organizacion_id=ORG, proveedor="gmail", cuenta_externa="p@gmail.com",
        access_token="tok", refresh_token="ref", token_expira_en=timezone.now() + timedelta(minutes=50),
    )


def worker(nombre, lector, c, procesar):
    return Hilo(nombre, lambda: leer_siguiente_lote(
        lector, organizacion_id=ORG, cuenta_id=c.pk, procesar=procesar, ahora=LUNES,
    ))


def _terminar(*hilos):
    for hilo in hilos:
        hilo.join(ESPERA)
    for hilo in hilos:
        assert not hilo.is_alive(), f"{hilo.name} no terminó"
        assert hilo.error is None, hilo.error


@pytest.mark.django_db(transaction=True)
class TestDosWorkersConDosConexiones:
    def test_B_espera_la_fila_y_descarta_la_pagina_que_A_ya_proceso(self, solo_postgres, claves):
        c = cuenta()
        primera = PaginaDeMensajes((mensaje(c, 1), mensaje(c, 2)), "tok-2")
        lector = LectorCoordinado({None: primera}, detener=("A", "B"))
        procesar = ProcesarCoordinado(detener="A")
        a, b = worker("A", lector, c, procesar), worker("B", lector, c, procesar)

        try:
            a.start()
            assert lector.leyendo["A"].wait(ESPERA), "A nunca llegó al proveedor"
            b.start()
            assert lector.leyendo["B"].wait(ESPERA), "B nunca llegó al proveedor"
            # A y B leyeron el mismo cursor: el inicio de la corrida.
            assert sorted(lector.pedidos) == [("A", None), ("B", None)]

            lector.puede_volver["A"].set()
            assert procesar.procesando.wait(ESPERA), "A nunca llegó a procesar"
            # A tiene la fila. Ahora B termina de leer y quiere tomarla.
            lector.puede_volver["B"].set()
            _hasta_que(lambda: _esperando_un_bloqueo(lector.pids["B"]),
                       descripcion="B esperara la fila de A", salvo_que=lambda: not b.is_alive())
            assert procesar.de("B") == [], "B procesó mientras A tenía la fila"
        finally:
            for evento in (*lector.puede_volver.values(), procesar.soltar):
                evento.set()
            _terminar(a, b)

        assert a.resultado.mensajes == 2 and not a.resultado.descartado
        assert b.resultado.descartado and b.resultado.mensajes == 0
        assert procesar.lotes == [("A", ["m1", "m2"])], "la página se procesó más de una vez"
        assert AvanceDeLectura.objects.get(cuenta=c).pagina == "tok-2"

    def test_B_que_empieza_mientras_A_procesa_sigue_desde_donde_A_dejo(self, solo_postgres, claves):
        c = cuenta()
        lector = LectorCoordinado({
            None: PaginaDeMensajes((mensaje(c, 1),), "tok-2"),
            "tok-2": PaginaDeMensajes((mensaje(c, 2),), None),
        })
        procesar = ProcesarCoordinado(detener="A")
        a, b = worker("A", lector, c, procesar), worker("B", lector, c, procesar)

        try:
            a.start()
            assert procesar.procesando.wait(ESPERA), "A nunca llegó a procesar"
            b.start()
            # B todavía no habló con el proveedor, así que no se sabe su
            # conexión: se busca una que espere y que no sea la de A.
            _hasta_que(lambda: _otro_espera_un_bloqueo(que_no_es=lector.pids["A"]),
                       descripcion="B esperara la fila al leer el cursor", salvo_que=lambda: not b.is_alive())
            assert [quien for quien, _ in lector.pedidos] == ["A"], "B leyó el cursor sin esperar a A"
        finally:
            procesar.soltar.set()
            _terminar(a, b)

        assert lector.pedidos == [("A", None), ("B", "tok-2")]
        assert procesar.lotes == [("A", ["m1"]), ("B", ["m2"])]
        assert b.resultado.corrida_terminada
        assert AvanceDeLectura.objects.get(cuenta=c).leido_hasta == LUNES

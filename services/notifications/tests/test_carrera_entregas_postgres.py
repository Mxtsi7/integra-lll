"""
S3-FE-21 — dos workers a la vez, con dos conexiones a PostgreSQL de verdad.

`test_entregas_s3_fe_21.py` prueba las decisiones con una conexión. Lo que no
puede probar es que dos procesos que despachan a la vez no manden dos veces
la misma alerta, ni que la cuota diaria aguante a dos workers mandándole a la
misma persona. Eso depende de los bloqueos de PostgreSQL. Esto es eso.

── Cómo se vuelve determinístico ──────────────────────────────────────────
No hay `sleep` que decida nada. El hilo A corre con su propia conexión y se
detiene en el punto que se le pida (con un `monkeypatch` que solo frena al
hilo llamado "A"), avisa y no sigue hasta que la prueba lo suelte. Mientras
A está detenido, el hilo B corre lo mismo, y la prueba mira en `pg_locks`
que B esté ESPERANDO (`granted = false`) o que haya terminado sin mandar.

── Lo que se exige ────────────────────────────────────────────────────────
1. A detenido DENTRO del reclamo: B espera el bloqueo de la persona y, al
   soltarse, ya no encuentra nada que mandar. Un correo.
2. A detenido HABLANDO CON EL PROVEEDOR (reclamo confirmado): B termina sin
   tocarla. Un correo.
3. Cuota: A y B mandan dos push distintos a la misma persona, a la que le
   queda uno. B espera a A y, aunque A todavía no sabe si el suyo salió, lo
   cuenta: B queda diferida. Dos en el día, no tres.
4. Limpieza de la organización o de la persona mientras A tiene a la persona
   bloqueada: espera y termina, sin interbloqueo.
5. A retoma una entrega cuyo reclamo venció y llega tarde el resultado del
   reclamo viejo: espera a A y no se anota (`tardia`).

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma y otra conexión no vería nada. Solo contra
PostgreSQL: SQLite en memoria no se comparte entre hilos.
"""

import queue
import threading
import time
import uuid

import pytest
from django.core import mail
from django.db import connection, connections

from notifications import canales, entregas
from notifications.models import EntregaAlerta
from tests.test_eliminacion_proyeccion import SECRETO, limpiar
from tests.test_entregas_s3_fe_21 import (
    DobleDePush,
    a_las,
    borrar_persona,
    la_entrega,
    nueva_alerta,
    persona,
)

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
ESPERA = 15.0
Estado = EntregaAlerta.Estado

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def solo_postgres():
    """En tiempo de ejecución: el conftest puede cambiar la base a SQLite."""
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


@pytest.fixture(autouse=True)
def buzon(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.DEFAULT_FROM_EMAIL = "no-responder@ejemplo.cl"
    mail.outbox = []
    yield mail.outbox


class Hilo(threading.Thread):
    """Un hilo con su conexión propia, que guarda su resultado o su error."""

    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.resultado = None
        self.error = None
        self.pid = queue.Queue()
        self.termino = threading.Event()

    def run(self):
        try:
            with connection.cursor() as cursor:
                # Si algo se traba, falla por tiempo en vez de colgar la suite.
                cursor.execute("SET lock_timeout = '8s'")
            self.pid.put(connection.connection.info.backend_pid)
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connections.close_all()
            self.termino.set()


class Freno:
    """Detiene al hilo "A" la primera vez que pasa por el punto envuelto."""

    def __init__(self):
        self.llego = threading.Event()
        self.soltar = threading.Event()

    def envolver(self, funcion):
        def frenada(*args, **kwargs):
            resultado = funcion(*args, **kwargs)
            if threading.current_thread().name == "A" and not self.llego.is_set():
                self.llego.set()
                assert self.soltar.wait(ESPERA), "nadie soltó a A"
            return resultado
        return frenada


def esperando_un_bloqueo(pid: int) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM pg_locks WHERE pid = %s AND NOT granted", [pid])
        return cursor.fetchone()[0] > 0


def hasta_que_espere(hilo: Hilo, que: str) -> None:
    pid = hilo.pid.get(timeout=ESPERA)
    limite = time.monotonic() + ESPERA
    while not esperando_un_bloqueo(pid):
        if hilo.termino.is_set():
            pytest.fail(f"B terminó sin esperar {que}: resultado={hilo.resultado} error={hilo.error}")
        assert time.monotonic() < limite, f"B nunca quedó esperando {que}"
        time.sleep(0.02)


def terminar(*hilos: Hilo) -> None:
    for hilo in hilos:
        hilo.join(ESPERA)
        assert not hilo.is_alive(), f"{hilo.name} quedó colgado"
        assert hilo.error is None, f"{hilo.name}: {hilo.error!r}"


def test_A_detenido_dentro_del_reclamo_B_espera_y_no_la_manda_otra_vez(monkeypatch, buzon):
    persona("42")
    nueva_alerta()
    freno = Freno()
    monkeypatch.setattr(canales.CanalCorreo, "destino", freno.envolver(canales.CanalCorreo.destino))

    hilo_a = Hilo("A", lambda: entregas.despachar(ahora=a_las(10)))
    hilo_b = Hilo("B", lambda: entregas.despachar(ahora=a_las(10)))
    try:
        hilo_a.start()
        assert freno.llego.wait(ESPERA), "A nunca llegó al reclamo"
        hilo_b.start()
        hasta_que_espere(hilo_b, "el bloqueo de la persona")
        assert buzon == []
    finally:
        freno.soltar.set()
    terminar(hilo_a, hilo_b)

    assert len(buzon) == 1, f"salieron {len(buzon)} correos"
    assert hilo_a.resultado[entregas.ACEPTADA] == 1
    assert hilo_b.resultado[entregas.SIN_TOCAR] == 1
    assert la_entrega().intentos == 1


def test_A_hablando_con_el_proveedor_B_no_la_toma(monkeypatch, buzon):
    persona("42")
    nueva_alerta()
    freno = Freno()
    real = canales.CanalCorreo.enviar

    def enviar(self, envio):
        if threading.current_thread().name == "A":
            freno.llego.set()
            assert freno.soltar.wait(ESPERA), "nadie soltó a A"
        return real(self, envio)

    monkeypatch.setattr(canales.CanalCorreo, "enviar", enviar)
    hilo_a = Hilo("A", lambda: entregas.despachar(ahora=a_las(10)))
    hilo_b = Hilo("B", lambda: entregas.despachar(ahora=a_las(10)))
    try:
        hilo_a.start()
        assert freno.llego.wait(ESPERA), "A nunca llegó al proveedor"
        # El reclamo de A ya está confirmado: la ve cualquiera.
        assert la_entrega().estado == Estado.ENVIANDO
        hilo_b.start()
        assert hilo_b.termino.wait(ESPERA), "B no terminó mientras A mandaba"
        assert hilo_b.error is None, hilo_b.error
        assert hilo_b.resultado.conteo == {}, f"B hizo algo: {hilo_b.resultado.conteo}"
        assert buzon == []
    finally:
        freno.soltar.set()
    terminar(hilo_a, hilo_b)
    assert len(buzon) == 1
    assert la_entrega().estado == Estado.ACEPTADA


def test_la_cuota_aguanta_dos_workers_para_la_misma_persona(monkeypatch, settings):
    doble = DobleDePush()
    monkeypatch.setitem(canales.CANALES, "push", doble)
    settings.CANALES_HABILITADOS = ["email", "push", "in_app"]
    persona("42", por_email=False, por_push=True)
    # Ya salió uno hoy: le queda uno.
    ya_salio = nueva_alerta(ahora=a_las(9))
    EntregaAlerta.objects.filter(alerta=ya_salio).update(estado=Estado.ACEPTADA, aceptada_en=a_las(9))
    para_a = nueva_alerta(ahora=a_las(15)).entregas.get()
    para_b = nueva_alerta(ahora=a_las(15)).entregas.get()

    contando = Freno()                       # A contó y tiene a la persona
    mandando = Freno()                       # A reclamó y está mandando
    monkeypatch.setattr(entregas, "_enviadas_en", (
        lambda real: lambda entrega, ahora: contando.envolver(real(entrega, ahora))
    )(entregas._enviadas_en))
    real_enviar = doble.enviar

    def enviar(envio):
        if threading.current_thread().name == "A":
            mandando.llego.set()
            assert mandando.soltar.wait(ESPERA), "nadie soltó a A"
        return real_enviar(envio)

    doble.enviar = enviar
    hilo_a = Hilo("A", lambda: entregas.atender(para_a.pk, ahora=a_las(15)))
    hilo_b = Hilo("B", lambda: entregas.atender(para_b.pk, ahora=a_las(15)))
    try:
        hilo_a.start()
        assert contando.llego.wait(ESPERA), "A nunca contó"
        hilo_b.start()
        hasta_que_espere(hilo_b, "a que A suelte a la persona")
        contando.soltar.set()
        assert mandando.llego.wait(ESPERA), "A nunca llegó a mandar"
        # A todavía no sabe si el suyo salió; B igual tiene que contarlo.
        assert hilo_b.termino.wait(ESPERA), "B no terminó"
        assert hilo_b.error is None, hilo_b.error
        assert hilo_b.resultado == entregas.DIFERIDA, f"B: {hilo_b.resultado}"
    finally:
        contando.soltar.set()
        mandando.soltar.set()
    terminar(hilo_a, hilo_b)

    assert hilo_a.resultado == entregas.ACEPTADA
    para_b.refresh_from_db()
    assert (para_b.estado, para_b.motivo) == (Estado.DIFERIDA, "cuota_diaria")
    assert len(doble.enviados) == 1
    assert EntregaAlerta.objects.filter(estado=Estado.ACEPTADA).count() == 2


@pytest.mark.parametrize("limpieza", ["organizacion", "persona"])
def test_una_limpieza_mientras_A_tiene_a_la_persona_no_se_traba(monkeypatch, limpieza, buzon):
    """El despachador bloquea preferencia y después entrega; las limpiezas
    borran en el mismo orden. A se detiene ENTRE los dos bloqueos: si una
    limpieza borrara primero la entrega, ella tendría la entrega esperando la
    preferencia y A la preferencia esperando la entrega."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
    persona("42")
    nueva_alerta()
    entrega_id = la_entrega().pk
    freno = Freno()
    monkeypatch.setattr(entregas, "elegibles", freno.envolver(entregas.elegibles))

    def limpiar_ahora():
        respuesta = limpiar(ORG) if limpieza == "organizacion" else borrar_persona(ORG, 42)
        return respuesta.status_code

    hilo_a = Hilo("A", lambda: entregas.atender(entrega_id, ahora=a_las(10)))
    hilo_b = Hilo("B", limpiar_ahora)
    try:
        hilo_a.start()
        assert freno.llego.wait(ESPERA), "A nunca tomó a la persona"
        hilo_b.start()
        hasta_que_espere(hilo_b, "a que A suelte a la persona")
    finally:
        freno.soltar.set()
    terminar(hilo_a, hilo_b)

    assert hilo_b.resultado == 204
    assert not EntregaAlerta.objects.filter(pk=entrega_id).exists()
    # A alcanzó a reclamarla antes de la limpieza y la mandó; lo que anote
    # después cae sobre una fila que ya no existe y no la recrea.
    assert hilo_a.resultado in (entregas.ACEPTADA, entregas.TARDIA)


def test_un_resultado_tardio_espera_al_que_retoma_y_no_lo_pisa(monkeypatch, buzon):
    """El reclamo de un worker venció y A la está retomando. Llega tarde el
    resultado del primero: tiene que esperar a A (la entrega está bloqueada)
    y, cuando entra, el reclamo ya no es el suyo. Sin el bloqueo de la
    entrega, el resultado viejo se anotaba y A lo pisaba con `enviando`."""
    persona("42")
    nueva_alerta()
    viejo = entregas.reclamar(la_entrega().pk, ahora=a_las(10))
    freno = Freno()
    monkeypatch.setattr(canales.CanalCorreo, "destino", freno.envolver(canales.CanalCorreo.destino))
    vence = a_las(10) + entregas.DURACION_RECLAMO

    hilo_a = Hilo("A", lambda: entregas.atender(viejo.entrega_id, ahora=vence))
    hilo_b = Hilo("B", lambda: entregas.anotar_aceptada(viejo, {"message_id": "viejo"}, ahora=vence))
    try:
        hilo_a.start()
        assert freno.llego.wait(ESPERA), "A nunca llegó a retomarla"
        hilo_b.start()
        hasta_que_espere(hilo_b, "a que A suelte la entrega")
    finally:
        freno.soltar.set()
    terminar(hilo_a, hilo_b)

    assert hilo_b.resultado == entregas.TARDIA
    assert hilo_a.resultado == entregas.ACEPTADA
    entrega = la_entrega()
    assert (entrega.estado, entrega.intentos) == (Estado.ACEPTADA, 2)
    assert entrega.evidencia["message_id"] == entrega.message_id != "viejo"
    assert len(buzon) == 1

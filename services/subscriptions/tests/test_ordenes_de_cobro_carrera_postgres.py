"""Dos órdenes del mismo proveedor, aplicadas A LA VEZ, con PostgreSQL.

El correo y la cartola del mismo cargo llegan como dos órdenes. Si es el
primer cobro de ese proveedor, las dos buscan la suscripción y no la
encuentran. Con dos órdenes en vuelo (dos consumidores, o un reintento que se
cruza) la carrera sería:

    A: busca la suscripción → no hay
    B: busca la suscripción → no hay (A todavía no confirma)
    A: crea la suscripción y su cobro
    B: crea OTRA suscripción y su cobro   ← dos suscripciones, sin hallazgo

El `FOR UPDATE` de la búsqueda no lo evita: no bloquea una fila que todavía
no existe. Y con los cobros en suscripciones distintas, el posible doble
cobro tampoco sale, porque se busca dentro de la misma suscripción.

Lo que la evita es el lock `ordenes_de_cobro` por organización que toma
`aplicar` antes de buscar. Para probarlo, A se detiene JUSTO DESPUÉS de
crear la suscripción y no sigue hasta que la prueba la suelte:

  · con el lock, B queda esperando en `pg_advisory_xact_lock` (se ve en
    `pg_locks` con `granted = false`) y, cuando A termina, encuentra su
    suscripción: un cobro más en ella y el hallazgo de posible doble cobro;
  · sin el lock, B termina entera mientras A está detenida.

Solo PostgreSQL: en SQLite el lock es un no-op y no hay dos conexiones.
"""

import threading
import time
import uuid

import pytest
from django.db import connection, connections

import app.candidatos as candidatos
from app.models import CandidatoAplicado, Cobro, HallazgoCobro, Proveedor, Subscription
from shared.bloqueo import ESPACIOS
from shared.borrado.models import EstadoOrganizacion
from tests.test_ordenes_de_cobro_rf14 import sobre

ESPERA = 15.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("la carrera solo existe en PostgreSQL")


def _esperando_el_lock() -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid = %s AND NOT granted",
            [ESPACIOS["ordenes_de_cobro"]],
        )
        return cursor.fetchone()[0]


def _hasta_que(condicion, *, descripcion, salvo_que=None, porque=""):
    limite = time.monotonic() + ESPERA
    while time.monotonic() < limite:
        if condicion():
            return
        if salvo_que is not None and salvo_que():
            pytest.fail(f"no pasó que {descripcion}: {porque}")
        time.sleep(0.02)
    pytest.fail(f"pasaron {ESPERA:.0f} s y no: {descripcion}")


class Hilo(threading.Thread):
    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.resultado = None
        self.error = None
        self.termino = threading.Event()

    def run(self):
        try:
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connections.close_all()
            self.termino.set()


@pytest.mark.django_db(transaction=True)
def test_la_segunda_orden_espera_a_la_primera_y_usa_su_suscripcion(solo_postgres, monkeypatch):
    org = uuid.uuid4()
    Proveedor.objects.get_or_create(nombre="Netflix", defaults={"categoria": "streaming"})
    # La fila de estado ya existe en una organización con historia. Si la
    # crea A dentro de su transacción, B espera ese INSERT y no llega al lock
    # que esta prueba mira (también serializa, pero solo la primera vez).
    EstadoOrganizacion.objects.create(organizacion_id=org)

    a_creo = threading.Event()
    a_puede_seguir = threading.Event()
    buscar = candidatos._suscripcion

    def busca_y_se_detiene_en_A(*args, **kwargs):
        encontrada = buscar(*args, **kwargs)
        if threading.current_thread().name == "A":
            a_creo.set()
            assert a_puede_seguir.wait(ESPERA), "la prueba nunca soltó a A"
        return encontrada

    monkeypatch.setattr(candidatos, "_suscripcion", busca_y_se_detiene_en_A)

    a = Hilo("A", lambda: candidatos.aplicar(sobre(org, origen="correo", fecha="2026-11-05")))
    a.start()
    _hasta_que(a_creo.is_set, descripcion="A creó la suscripción",
               salvo_que=a.termino.is_set, porque=f"A terminó antes: {a.error!r}")

    b = Hilo("B", lambda: candidatos.aplicar(sobre(org, origen="csv", fecha="2026-11-05")))
    b.start()
    try:
        _hasta_que(lambda: _esperando_el_lock() == 1, descripcion="B quedó esperando el lock de A",
                   salvo_que=b.termino.is_set,
                   porque="B terminó mientras A seguía detenida: el lock no serializa las órdenes")
    finally:
        a_puede_seguir.set()
        a.join(ESPERA)
        b.join(ESPERA)

    for hilo in (a, b):
        if hilo.error is not None:
            raise hilo.error
    (suscripcion,) = Subscription.objects.filter(organizacion_id=org)
    assert not b.resultado.fila.suscripcion_creada
    assert Cobro.objects.filter(suscripcion=suscripcion).count() == 2
    assert HallazgoCobro.objects.filter(
        organizacion_id=org, tipo=HallazgoCobro.Tipo.DOBLE_COBRO, estado=HallazgoCobro.Estado.PENDIENTE
    ).count() == 1
    assert set(CandidatoAplicado.objects.filter(organizacion_id=org).values_list("origen", flat=True)) == {
        "correo", "csv",
    }


@pytest.mark.django_db(transaction=True)
def test_organizaciones_distintas_no_se_esperan(solo_postgres):
    """Si todas colapsaran en una clave, se serializaría el servicio entero."""
    from django.db import transaction

    from shared.bloqueo import bloquear

    with transaction.atomic():
        for _ in range(3):
            bloquear("ordenes_de_cobro", uuid.uuid4())
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(DISTINCT objid) FROM pg_locks WHERE locktype = 'advisory' "
                "AND classid = %s AND pid = pg_backend_pid()",
                [ESPACIOS["ordenes_de_cobro"]],
            )
            assert cursor.fetchone()[0] == 3

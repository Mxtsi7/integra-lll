"""
El recálculo del resumen con dos conexiones a PostgreSQL de verdad.

Las pruebas de `pg_locks` en `test_eventos.py` comprueban que el lock se
toma y que organizaciones distintas no se bloquean entre sí. **No**
reproducen la carrera: para eso hacen falta dos conexiones intercalándose en
el punto exacto. Esto es eso.

── La carrera ─────────────────────────────────────────────────────────────
    A: SUM = 1000
    (llega otra suscripción de 2000)
    B: SUM = 3000, guarda 3000
    A: guarda su 1000, que ya estaba viejo
Queda la fuente en 3000 con el resumen en 1000. Lo encontró la revisión de
#106 y la corrección fue tomar el advisory lock ANTES de leer.

── Cómo se vuelve determinística ──────────────────────────────────────────
No hay `sleep` que decida nada. La conexión A se detiene **justo después de
leer** (se intercepta la evaluación del queryset solo en su hilo) y no sigue
hasta que la prueba la suelte. Mientras A está detenida, la prueba inserta
la otra suscripción desde la conexión principal y lanza B:

  · con el lock bien puesto, B llega a `pg_advisory_xact_lock` y QUEDA
    ESPERANDO, y eso se ve en `pg_locks` con `granted = false`;
  · sin el lock, o con el lock después de leer, B no espera: termina entera
    mientras A sigue detenida, y cuando A escribe pisa el resumen.

Solo contra PostgreSQL: SQLite en memoria no se comparte entre hilos y no
tiene advisory locks. `transaction=True` para que las dos conexiones vean lo
mismo que verían dos workers.
"""

import threading
import time
import uuid
from datetime import date
from decimal import Decimal

import pytest
from django.db import connection, connections
from django.db.models.query import QuerySet

from app.models import ResumenOrganizacion, Subscription
from events.trabajo import recalcular_resumen
from shared.bloqueo import ESPACIOS

ESPERA = 15.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("la carrera solo existe en PostgreSQL")


def crear(org, monto):
    return Subscription.objects.create(
        organizacion_id=org, nombre=f"Servicio {monto}", monto=Decimal(monto),
        moneda="CLP", frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 11, 1), categoria="streaming",
        estado=Subscription.Estado.ACTIVO,
    )


def total(org):
    return ResumenOrganizacion.objects.get(organizacion_id=org, moneda="CLP").total_mensual


def _esperando_lock_del_resumen() -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_locks "
            "WHERE locktype = 'advisory' AND classid = %s AND NOT granted",
            [ESPACIOS["resumen_organizacion"]],
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
        self.error = None
        self.termino = threading.Event()

    def run(self):
        try:
            self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            # Cada hilo tiene SU conexión; si quedara abierta, el vaciado de
            # tablas del final se quedaría esperando.
            connections.close_all()
            self.termino.set()


@pytest.mark.django_db(transaction=True)
class TestCarreraEntreDosConexiones:
    def test_B_espera_a_A_y_el_resumen_queda_bien(self, solo_postgres, monkeypatch):
        org = uuid.uuid4()
        crear(org, "1000")
        recalcular_resumen(org)
        assert total(org) == Decimal("1000.00")

        # ── Detener a A justo después de LEER la fuente ─────────────────────
        a_leyo = threading.Event()
        a_puede_seguir = threading.Event()
        fetch_original = QuerySet._fetch_all

        def fetch_que_se_detiene_en_A(self):
            fetch_original(self)
            if threading.current_thread().name == "A" and not a_leyo.is_set():
                a_leyo.set()
                assert a_puede_seguir.wait(ESPERA), "nadie soltó a A"

        monkeypatch.setattr(QuerySet, "_fetch_all", fetch_que_se_detiene_en_A)

        hilo_a = Hilo("A", lambda: recalcular_resumen(org))
        hilo_b = Hilo("B", lambda: recalcular_resumen(org))
        try:
            hilo_a.start()
            assert a_leyo.wait(ESPERA), "A nunca llegó a leer"
            assert hilo_a.error is None, hilo_a.error

            # Mientras A está detenida con su lectura vieja, llega otra
            # suscripción (confirmada) y B va a recalcular.
            crear(org, "2000")
            hilo_b.start()
            _hasta_que(
                lambda: _esperando_lock_del_resumen() == 1,
                descripcion="B quedó esperando el advisory lock del resumen",
                salvo_que=hilo_b.termino.is_set,
                porque="B terminó entera mientras A seguía detenida",
            )
            assert not hilo_b.termino.is_set(), "B terminó sin esperar a A"
            assert total(org) == Decimal("1000.00"), "alguien escribió mientras A estaba detenida"
        finally:
            a_puede_seguir.set()
            hilo_a.join(ESPERA)
            hilo_b.join(ESPERA)

        assert not hilo_a.is_alive() and not hilo_b.is_alive(), "un hilo quedó colgado"
        assert hilo_a.error is None, hilo_a.error
        assert hilo_b.error is None, hilo_b.error

        # A escribió su 1000 viejo; B, DESPUÉS y con la fuente completa, 3000.
        assert total(org) == Decimal("3000.00")
        assert _esperando_lock_del_resumen() == 0

    def test_organizaciones_distintas_no_se_esperan(self, solo_postgres, monkeypatch):
        """El control: el lock es por organización. B de OTRA organización no
        tiene por qué esperar a A."""
        org_a, org_b = uuid.uuid4(), uuid.uuid4()
        crear(org_a, "1000")
        crear(org_b, "500")

        a_leyo = threading.Event()
        a_puede_seguir = threading.Event()
        fetch_original = QuerySet._fetch_all

        def fetch_que_se_detiene_en_A(self):
            fetch_original(self)
            if threading.current_thread().name == "A" and not a_leyo.is_set():
                a_leyo.set()
                assert a_puede_seguir.wait(ESPERA), "nadie soltó a A"

        monkeypatch.setattr(QuerySet, "_fetch_all", fetch_que_se_detiene_en_A)
        hilo_a = Hilo("A", lambda: recalcular_resumen(org_a))
        hilo_b = Hilo("B", lambda: recalcular_resumen(org_b))
        try:
            hilo_a.start()
            assert a_leyo.wait(ESPERA)
            hilo_b.start()
            assert hilo_b.termino.wait(ESPERA), "B de otra organización se quedó esperando"
            assert _esperando_lock_del_resumen() == 0
        finally:
            a_puede_seguir.set()
            hilo_a.join(ESPERA)
            hilo_b.join(ESPERA)
        assert hilo_a.error is None and hilo_b.error is None
        assert total(org_a) == Decimal("1000.00")
        assert total(org_b) == Decimal("500.00")

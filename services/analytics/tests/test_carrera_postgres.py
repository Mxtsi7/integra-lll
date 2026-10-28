"""
FE-28 — la carrera entre dos conexiones, reproducida de verdad.

Las pruebas de `pg_locks` en `test_uso.py` comprueban que el lock se toma, se
suelta y que claves distintas dan locks distintos. **No** reproducen la
carrera: para eso hacen falta dos conexiones a PostgreSQL intercalándose en
el punto exacto. Esto es eso.

── La carrera ─────────────────────────────────────────────────────────────
    A: SUM = 100
    B: inserta 20, recalcula, guarda 120
    A: guarda sus 100, que ya estaban viejos
Queda la fuente en 120 con el agregado en 100. Lo encontró la revisión de
#110/#111 y la corrección fue tomar el advisory lock ANTES del SUM.

── Cómo se vuelve determinística ──────────────────────────────────────────
No hay `sleep` que decida nada. La conexión A se detiene **justo después de
leer** (se intercepta `QuerySet.aggregate` solo en su hilo) y no sigue hasta
que la prueba la suelte. Mientras A está detenida:

  · con el lock bien puesto, B llega a `pg_advisory_xact_lock` y QUEDA
    ESPERANDO, y eso se ve en `pg_locks` con `granted = false`;
  · sin el lock, o con el lock después del SUM, B no espera: termina entera
    mientras A sigue detenida, y cuando A escribe pisa el agregado.

La prueba exige lo primero: que B esté esperando el lock de FE-28 mientras A
está detenida, que B no haya terminado, y que al soltar A el agregado final
sea la suma de los dos registros. Las tres cosas fallan sin el lock, y las
dos primeras también si el lock se mueve después del SUM.

── Por qué `transaction=True` ─────────────────────────────────────────────
pytest-django envuelve cada prueba en una transacción que no se confirma, y
otra conexión no vería nada. Acá las dos conexiones tienen que ver lo mismo
que verían dos workers, así que se confirma de verdad y la tabla se vacía
al final.

Solo corre contra PostgreSQL: SQLite serializa las escrituras por sí solo y
no tiene advisory locks, así que la carrera no existe ahí.
"""

import datetime as dt
import threading
import time
import uuid

import pytest
from django.db import connection, connections
from django.db.models.query import QuerySet

from analytics.models import UsoMensual, UsoProyectado
from analytics.uso import proyectar_uso, recalcular_mes
from shared.bloqueo import ESPACIOS

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
SUSC = uuid.UUID("33333333-3333-3333-3333-333333333333")
OCTUBRE = dt.date(2026, 10, 1)

#: Si algo se traba, la prueba falla por tiempo en vez de colgar la suite.
ESPERA = 15.0


@pytest.fixture
def solo_postgres():
    """En tiempo de ejecución, no al importar: el conftest cambia la base
    a SQLite después de que el módulo se importa."""
    if connection.vendor != "postgresql":
        pytest.skip("la carrera solo existe en PostgreSQL")


def _esperando_lock_de_fe28() -> int:
    """Cuántas sesiones están ESPERANDO (no tienen) un advisory lock del
    espacio de FE-28. Se consulta desde la conexión principal."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_locks "
            "WHERE locktype = 'advisory' AND classid = %s AND NOT granted",
            [ESPACIOS["uso_mensual"]],
        )
        return cursor.fetchone()[0]


def _hasta_que(condicion, *, descripcion: str, salvo_que=None, porque: str = "") -> None:
    """Sondea `condicion` hasta que sea verdadera. Falla con nombre si no.

    `salvo_que` corta la espera al tiro: si B ya terminó, no tiene sentido
    seguir esperando a que se ponga a esperar.
    """
    limite = time.monotonic() + ESPERA
    while time.monotonic() < limite:
        if condicion():
            return
        if salvo_que is not None and salvo_que():
            pytest.fail(f"no pasó que {descripcion}: {porque}")
        time.sleep(0.02)
    pytest.fail(f"pasaron {ESPERA:.0f} s y no: {descripcion}")


class Hilo(threading.Thread):
    """Un hilo con su propia conexión a la base, que guarda su error."""

    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.error = None
        self.termino = threading.Event()

    def run(self):
        try:
            self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el hilo principal
            self.error = exc
        finally:
            # Cada hilo tiene SU conexión (Django las guarda por hilo). Hay
            # que cerrarla: si quedara abierta, el vaciado de tablas del final
            # se quedaría esperando.
            connections.close_all()
            self.termino.set()


@pytest.mark.django_db(transaction=True)
class TestCarreraEntreDosConexiones:
    def test_B_espera_a_A_y_el_agregado_queda_bien(self, solo_postgres, monkeypatch):
        # ── Estado inicial, confirmado: un registro de 100 minutos ─────────
        proyectar_uso(
            organizacion_id=ORG, suscripcion_id=SUSC, evento_id=uuid.uuid4(),
            fecha=dt.date(2026, 10, 3), minutos=100,
        )
        assert UsoMensual.objects.get(mes=OCTUBRE).minutos == 100

        # ── Detener a A justo después de leer ───────────────────────────────
        a_leyo = threading.Event()      # A ya hizo el SUM
        a_puede_seguir = threading.Event()  # la prueba suelta a A
        aggregate_original = QuerySet.aggregate

        def aggregate_que_se_detiene_en_A(self, *args, **kwargs):
            resultado = aggregate_original(self, *args, **kwargs)
            if threading.current_thread().name == "A" and not a_leyo.is_set():
                a_leyo.set()
                assert a_puede_seguir.wait(ESPERA), "nadie soltó a A"
            return resultado

        monkeypatch.setattr(QuerySet, "aggregate", aggregate_que_se_detiene_en_A)

        hilo_a = Hilo("A", lambda: recalcular_mes(
            organizacion_id=ORG, suscripcion_id=SUSC, mes=OCTUBRE,
        ))
        hilo_b = Hilo("B", lambda: proyectar_uso(
            organizacion_id=ORG, suscripcion_id=SUSC, evento_id=uuid.uuid4(),
            fecha=dt.date(2026, 10, 5), minutos=20,
        ))

        try:
            # A: toma el lock, lee SUM = 100 y se queda detenida ahí.
            hilo_a.start()
            assert a_leyo.wait(ESPERA), "A nunca llegó a leer"
            assert hilo_a.error is None, hilo_a.error

            # B: inserta sus 20 y va a recalcular. Tiene que QUEDAR ESPERANDO
            # el lock que A todavía tiene.
            hilo_b.start()
            # Esto es lo que falla si el lock no está o está después del SUM:
            # B pasa de largo, escribe 120, y A después lo pisa con 100.
            _hasta_que(
                lambda: _esperando_lock_de_fe28() == 1,
                descripcion="B quedó esperando el advisory lock de FE-28",
                salvo_que=hilo_b.termino.is_set,
                porque="B terminó entera mientras A seguía detenida",
            )
            # Y mientras A sigue detenida, B no puede haber terminado.
            assert not hilo_b.termino.is_set(), "B terminó sin esperar a A"
            assert UsoMensual.objects.get(mes=OCTUBRE).minutos == 100, (
                "B escribió mientras A estaba detenida"
            )
        finally:
            # Pase lo que pase, soltar a A para no colgar la suite.
            a_puede_seguir.set()
            hilo_a.join(ESPERA)
            hilo_b.join(ESPERA)

        assert not hilo_a.is_alive() and not hilo_b.is_alive(), "un hilo quedó colgado"
        assert hilo_a.error is None, hilo_a.error
        assert hilo_b.error is None, hilo_b.error

        # ── El final: B recalculó DESPUÉS de A, con la fuente completa ──────
        assert UsoProyectado.objects.count() == 2
        assert UsoMensual.objects.get(mes=OCTUBRE).minutos == 120
        assert _esperando_lock_de_fe28() == 0

    def test_dos_recalculos_del_mismo_mes_no_se_pisan(self, solo_postgres, monkeypatch):
        """La variante sin inserción: A y B recalculan el mismo mes a la vez.
        La segunda tiene que esperar; con el lock bien puesto el agregado
        termina igual que la suma de la fuente."""
        for minutos in (10, 20, 30):
            proyectar_uso(
                organizacion_id=ORG, suscripcion_id=SUSC, evento_id=uuid.uuid4(),
                fecha=dt.date(2026, 10, 3), minutos=minutos,
            )
        a_leyo = threading.Event()
        a_puede_seguir = threading.Event()
        aggregate_original = QuerySet.aggregate

        def aggregate_que_se_detiene_en_A(self, *args, **kwargs):
            resultado = aggregate_original(self, *args, **kwargs)
            if threading.current_thread().name == "A" and not a_leyo.is_set():
                a_leyo.set()
                assert a_puede_seguir.wait(ESPERA), "nadie soltó a A"
            return resultado

        monkeypatch.setattr(QuerySet, "aggregate", aggregate_que_se_detiene_en_A)
        recalcular = lambda: recalcular_mes(  # noqa: E731
            organizacion_id=ORG, suscripcion_id=SUSC, mes=OCTUBRE,
        )
        hilo_a, hilo_b = Hilo("A", recalcular), Hilo("B", recalcular)
        try:
            hilo_a.start()
            assert a_leyo.wait(ESPERA), "A nunca llegó a leer"
            hilo_b.start()
            _hasta_que(
                lambda: _esperando_lock_de_fe28() == 1,
                descripcion="B quedó esperando el advisory lock de FE-28",
                salvo_que=hilo_b.termino.is_set,
                porque="B terminó entera mientras A seguía detenida",
            )
            assert not hilo_b.termino.is_set(), "B terminó sin esperar a A"
        finally:
            a_puede_seguir.set()
            hilo_a.join(ESPERA)
            hilo_b.join(ESPERA)
        assert hilo_a.error is None, hilo_a.error
        assert hilo_b.error is None, hilo_b.error
        assert UsoMensual.objects.get(mes=OCTUBRE).minutos == 60

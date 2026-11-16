"""S3-FE-10 — el worker contra el rescate, con dos conexiones a PostgreSQL.

`test_procesar_importacion.py` prueba el mismo intercalado con UNA conexión y
pausas controladas. Es determinístico y vale: demuestra la decisión que toma
el código cuando la fila ya cambió. Lo que NO demuestra es el mecanismo que
sostiene esa decisión, que es el bloqueo de fila del `UPDATE` condicionado.
Esto es eso, y lo pidió la revisión de #147.

── Qué se exige ───────────────────────────────────────────────────────────
El cierre de una importación se reclama con el estado esperado en el `WHERE`,
dentro de la misma transacción que inserta los candidatos. De ahí salen dos
garantías, y cada una necesita su orden:

    el worker reclama primero  → el rescate SE BLOQUEA hasta el commit y
                                 después se encuentra 0 filas: no pisa el
                                 resultado bueno
    el rescate cierra primero  → el worker se encuentra 0 filas y no publica
                                 nada: ni candidatos, ni contadores, ni
                                 errores, ni estado

El primero es el que SQLite no puede mostrar: ahí la base entera se bloquea y
no hay dos transacciones mirándose. En PostgreSQL, con `READ COMMITTED`, el
que llega segundo espera el lock y después reevalúa su `WHERE` contra la fila
ya confirmada. Eso es lo que se comprueba acá.

── Cómo se vuelve determinístico ──────────────────────────────────────────
No hay un `sleep` que decida nada. El worker corre en su propio hilo y se
detiene en un punto exacto —justo después de reclamar el cierre, o justo
antes— avisa, y no sigue hasta que la prueba lo suelte. El único tiempo de
espera que hay es el que comprueba que el rescate QUEDÓ bloqueado, y es una
cota inferior: si no estuviera bloqueado, ya habría terminado.

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma, y la otra conexión no vería nada.
"""

import hashlib
import threading
import uuid
from datetime import timedelta

import pytest
from django.db import connection, connections
from django.utils import timezone

from connectors import csv_candidatos, tasks
from connectors.models import ArchivoImportacion, CobroCandidato, Importacion

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
USUARIO = "42"

#: Cuánto se espera a que un hilo llegue a su punto de encuentro. Generoso: si
#: se agota es que algo no pasó, no que el equipo esté lento.
ESPERA = 15.0

#: Cuánto se le da al rescate para demostrar que NO está bloqueado. Es una
#: cota inferior: sin el lock, el `UPDATE` vuelve en milisegundos.
MARGEN_DE_BLOQUEO = 2.0

CSV = (
    "fecha;descripcion;monto" + chr(10)
    + "2026-10-01;NETFLIX.COM;9990" + chr(10)
    + "2026-10-03;PAYPAL *SPOTIFY;4990" + chr(10)
).encode("utf-8")

CSV_SIN_MONTO = ("fecha;descripcion" + chr(10) + "2026-10-01;NETFLIX.COM" + chr(10)).encode("utf-8")


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


@pytest.fixture
def rescate_inmediato(settings):
    """Cualquier `procesando` cuenta como estancada.

    Es la forma honesta de provocar la carrera: envejecer la fila a mano no
    sirve, porque ese `UPDATE` también se bloquearía contra el worker y la
    prueba se trabaría en vez de probar algo.
    """
    settings.IMPORTACION_ESTANCADA_TRAS_MINUTOS = 0


class Hilo(threading.Thread):
    """Un hilo con su propia conexión, que guarda su error y su resultado."""

    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.error = None
        self.resultado = None
        self.termino = threading.Event()

    def run(self):
        try:
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connections.close_all()
            self.termino.set()

    def exigir_que_termino(self):
        self.join(ESPERA)
        assert not self.is_alive(), f"el hilo {self.name} se quedó colgado"
        if self.error is not None:
            raise self.error
        return self.resultado


def crear_importacion(contenido=CSV):
    importacion = Importacion.objects.create(
        organizacion_id=ORG,
        usuario_id=USUARIO,
        origen=Importacion.Origen.CSV,
        nombre_archivo="cartola.csv",
    )
    ArchivoImportacion.objects.create(
        organizacion_id=ORG,
        importacion=importacion,
        formato="csv",
        tamano=len(contenido),
        sha256=hashlib.sha256(contenido).hexdigest(),
        contenido=contenido,
        vence_en=timezone.now() + timedelta(days=7),
    )
    return importacion


@pytest.mark.django_db(transaction=True)
class TestElWorkerYElRescateSeCruzan:
    def test_el_worker_que_reclamo_primero_bloquea_al_rescate(
        self, solo_postgres, rescate_inmediato, monkeypatch
    ):
        """El orden que solo PostgreSQL puede mostrar.

        El worker reclama el cierre y se detiene con la transacción abierta.
        El rescate, en otra conexión, selecciona la fila —ve la versión
        confirmada, que todavía dice `procesando`— e intenta cerrarla: ahí se
        bloquea. Cuando el worker confirma, el rescate reevalúa su `WHERE`,
        se encuentra 0 filas y no toca nada.
        """
        importacion = crear_importacion()
        worker_reclamo = threading.Event()
        worker_puede_confirmar = threading.Event()
        real_bulk_create = CobroCandidato.objects.bulk_create

        def detenerse_con_el_cierre_reclamado(filas, **extra):
            # Acá adentro el `UPDATE` condicionado ya corrió y la fila está
            # bloqueada, pero la transacción no se confirmó todavía.
            worker_reclamo.set()
            assert worker_puede_confirmar.wait(ESPERA), "nadie soltó al worker"
            return real_bulk_create(filas, **extra)

        monkeypatch.setattr(
            CobroCandidato.objects, "bulk_create", detenerse_con_el_cierre_reclamado
        )

        worker = Hilo("worker", lambda: tasks.procesar_importacion(str(importacion.pk)))
        rescate = Hilo("rescate", tasks.rescatar_importaciones_estancadas)
        try:
            worker.start()
            assert worker_reclamo.wait(ESPERA), "el worker nunca reclamó el cierre"
            rescate.start()
            # Si el rescate NO estuviera bloqueado, ya habría terminado: su
            # trabajo son dos consultas. Que siga vivo es el lock.
            assert not rescate.termino.wait(MARGEN_DE_BLOQUEO), (
                "el rescate no se bloqueó: pudo escribir sobre una importación "
                "que otra transacción tenía reclamada"
            )
        finally:
            worker_puede_confirmar.set()

        salida_worker = worker.exigir_que_termino()
        salida_rescate = rescate.exigir_que_termino()

        # El worker publicó su resultado completo.
        assert salida_worker["estado"] == Importacion.Estado.COMPLETADA
        assert salida_worker["candidatos"] == 2
        # Y el rescate no cerró nada.
        assert salida_rescate["fallidas"] == 0

        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.COMPLETADA
        assert importacion.candidatos_detectados == 2
        assert importacion.errores_totales == 0
        assert CobroCandidato.objects.filter(importacion=importacion).count() == 2

    def test_el_rescate_que_cerro_primero_no_lo_pisa_el_worker(
        self, solo_postgres, rescate_inmediato, monkeypatch
    ):
        """El orden inverso, y el que la revisión de #147 encontró roto.

        El worker termina de parsear y se detiene ANTES de publicar. El
        rescate, en otra conexión, cierra la importación como fallida y
        confirma. Cuando el worker sigue, su `UPDATE` condicionado se
        encuentra 0 filas y no escribe nada: el motivo del rescate queda, y no
        aparecen candidatos de una importación que figura como fallida.
        """
        importacion = crear_importacion()
        worker_parseo = threading.Event()
        worker_puede_publicar = threading.Event()
        real_leer = csv_candidatos.leer

        def parsear_y_detenerse(*args, **extra):
            resultado = real_leer(*args, **extra)
            worker_parseo.set()
            assert worker_puede_publicar.wait(ESPERA), "nadie soltó al worker"
            return resultado

        monkeypatch.setattr(csv_candidatos, "leer", parsear_y_detenerse)

        worker = Hilo("worker", lambda: tasks.procesar_importacion(str(importacion.pk)))
        try:
            worker.start()
            assert worker_parseo.wait(ESPERA), "el worker nunca parseó"
            # Otra conexión cierra y CONFIRMA mientras el worker está detenido.
            cerrado = tasks.rescatar_importaciones_estancadas()
            assert cerrado["fallidas"] == 1
        finally:
            worker_puede_publicar.set()

        salida = worker.exigir_que_termino()

        assert salida["estado"] == Importacion.Estado.FALLIDA
        assert salida.get("repetida") is True

        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.FALLIDA
        assert importacion.errores_totales == 1
        assert importacion.errores[0]["codigo"] == tasks.PROCESAMIENTO_INTERRUMPIDO
        # Nada del parseo se publicó.
        assert importacion.candidatos_detectados == 0
        assert CobroCandidato.objects.filter(importacion=importacion).count() == 0

    def test_el_camino_de_error_del_worker_tampoco_pisa_al_rescate(
        self, solo_postgres, rescate_inmediato, monkeypatch
    ):
        """Lo mismo por `_terminar_mal`, que tenía el mismo agujero.

        Un CSV sin columna obligatoria no llega a publicar candidatos: llega a
        escribir su propio motivo. Si lo escribiera sin reclamar el estado, le
        taparía al rescate el `procesamiento_interrumpido` con un
        `faltan_columnas` sobre una importación que ya no es suya.
        """
        importacion = crear_importacion(CSV_SIN_MONTO)
        worker_parseo = threading.Event()
        worker_puede_publicar = threading.Event()
        real_leer = csv_candidatos.leer

        def parsear_y_detenerse(*args, **extra):
            try:
                return real_leer(*args, **extra)
            finally:
                worker_parseo.set()
                assert worker_puede_publicar.wait(ESPERA), "nadie soltó al worker"

        monkeypatch.setattr(csv_candidatos, "leer", parsear_y_detenerse)

        worker = Hilo("worker", lambda: tasks.procesar_importacion(str(importacion.pk)))
        try:
            worker.start()
            assert worker_parseo.wait(ESPERA), "el worker nunca parseó"
            assert tasks.rescatar_importaciones_estancadas()["fallidas"] == 1
        finally:
            worker_puede_publicar.set()

        worker.exigir_que_termino()

        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.FALLIDA
        assert importacion.errores_totales == 1
        assert importacion.errores[0]["codigo"] == tasks.PROCESAMIENTO_INTERRUMPIDO

    def test_dos_workers_sobre_la_misma_importacion_no_duplican(
        self, solo_postgres, monkeypatch
    ):
        """El otro cruce posible: la misma tarea entregada dos veces.

        La guarda de `avanzar_a(procesando)` deja pasar a uno solo, y la
        unicidad de (organización, origen, identificador) protege por si
        igual llegaran los dos a insertar.
        """
        importacion = crear_importacion()
        ambos_listos = threading.Barrier(2, timeout=ESPERA)

        def correr():
            # Los dos arrancan a la vez, de verdad, cada uno con su conexión.
            ambos_listos.wait()
            return tasks.procesar_importacion(str(importacion.pk))

        primero = Hilo("worker-1", correr)
        segundo = Hilo("worker-2", correr)
        primero.start()
        segundo.start()
        salidas = [primero.exigir_que_termino(), segundo.exigir_que_termino()]

        completadas = [s for s in salidas if s.get("candidatos") == 2]
        assert len(completadas) == 1, f"los dos publicaron: {salidas}"

        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.COMPLETADA
        assert importacion.candidatos_detectados == 2
        assert CobroCandidato.objects.filter(importacion=importacion).count() == 2

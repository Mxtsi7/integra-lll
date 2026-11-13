"""S3-FE-17 — dos importaciones que se traslapan, procesándose a la vez.

`test_duplicados_s3_fe_17.py` prueba la reimportación de a una. Esto prueba la
parte de "solicitudes concurrentes" de la tarjeta: dos workers, cada uno en su
conexión a PostgreSQL, insertando el MISMO cobro bajo importaciones distintas.

── Qué lo sostiene ──────────────────────────────────────────────────────────
No es el código de la tarea: ninguna de las dos ve a la otra al leer, porque
la otra no ha confirmado. Lo sostiene la restricción única
`candidato_unico_por_origen` (organización + origen + identificador). El
segundo `INSERT` del mismo identificador ESPERA a que el primero confirme o
revierta, y entonces `ON CONFLICT DO NOTHING` lo descarta. Eso es lo que acá
se comprueba con dos transacciones de verdad: SQLite bloquea la base entera y
no puede mostrarlo.

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma, y la otra conexión no vería nada.
"""

from datetime import timedelta
import hashlib
import threading
import uuid

import pytest
from django.db import connection, connections
from django.utils import timezone

from connectors import tasks
from connectors.models import ArchivoImportacion, CobroCandidato, Importacion

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
ESPERA = 15.0
MARGEN_DE_BLOQUEO = 2.0
NL = chr(10)

OCTUBRE = ("fecha;descripcion;monto" + NL + "2026-10-01;NETFLIX.COM;9990" + NL).encode("utf-8")
OCTUBRE_Y_NOVIEMBRE = (
    "fecha;descripcion;monto" + NL
    + "2026-10-01;NETFLIX.COM;9990" + NL
    + "2026-11-01;NETFLIX.COM;9990" + NL
).encode("utf-8")


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


class Hilo(threading.Thread):
    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.error = None

    def run(self):
        try:
            self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connections.close_all()

    def exigir_que_termino(self):
        self.join(ESPERA)
        assert not self.is_alive(), f"el hilo {self.name} se quedó colgado"
        if self.error is not None:
            raise self.error


def crear_importacion(contenido):
    importacion = Importacion.objects.create(
        organizacion_id=ORG, usuario_id="42", origen=Importacion.Origen.CSV, nombre_archivo="cartola.csv",
    )
    ArchivoImportacion.objects.create(
        organizacion_id=ORG, importacion=importacion, formato="csv", tamano=len(contenido),
        sha256=hashlib.sha256(contenido).hexdigest(), contenido=contenido,
        vence_en=timezone.now() + timedelta(days=7),
    )
    return importacion


@pytest.mark.django_db(transaction=True)
def test_dos_workers_con_el_mismo_cobro_dejan_un_solo_candidato(solo_postgres, monkeypatch):
    """El primero inserta y se detiene con la transacción abierta. El segundo
    llega al mismo `INSERT` y queda esperando la fila. Cuando el primero
    confirma, el segundo descarta el suyo y guarda solo lo nuevo."""
    primera = crear_importacion(OCTUBRE)
    segunda = crear_importacion(OCTUBRE_Y_NOVIEMBRE)
    primero_inserto = threading.Event()
    primero_puede_confirmar = threading.Event()
    real = CobroCandidato.objects.bulk_create

    def detenerse_tras_insertar(filas, **extra):
        creadas = real(filas, **extra)
        if threading.current_thread().name == "primero":
            primero_inserto.set()
            assert primero_puede_confirmar.wait(ESPERA), "nadie soltó al primero"
        return creadas

    monkeypatch.setattr(CobroCandidato.objects, "bulk_create", detenerse_tras_insertar)

    primero = Hilo("primero", lambda: tasks.procesar_importacion(str(primera.pk)))
    primero.start()
    assert primero_inserto.wait(ESPERA), "el primero no llegó a insertar"

    segundo = Hilo("segundo", lambda: tasks.procesar_importacion(str(segunda.pk)))
    segundo.start()
    segundo.join(MARGEN_DE_BLOQUEO)
    assert segundo.is_alive(), "el segundo no se bloqueó: insertó sin ver al primero"

    primero_puede_confirmar.set()
    primero.exigir_que_termino()
    segundo.exigir_que_termino()

    assert sorted(str(f) for f in CobroCandidato.objects.values_list("fecha", flat=True)) == [
        "2026-10-01", "2026-11-01",
    ]
    primera.refresh_from_db()
    segunda.refresh_from_db()
    assert primera.estado == segunda.estado == Importacion.Estado.COMPLETADA
    # Los contadores dicen lo que de verdad quedó bajo cada importación.
    assert (primera.candidatos_detectados, segunda.candidatos_detectados) == (1, 1)
    assert CobroCandidato.objects.get(fecha="2026-10-01").importacion_id == primera.pk


@pytest.mark.django_db(transaction=True)
def test_si_el_primero_revierte_el_segundo_se_queda_con_el_cobro(solo_postgres, monkeypatch):
    """La otra salida del bloqueo: el primero falla y revierte. El cobro no
    puede perderse por eso: el segundo, que esperaba, lo inserta."""
    primera = crear_importacion(OCTUBRE)
    segunda = crear_importacion(OCTUBRE_Y_NOVIEMBRE)
    primero_inserto = threading.Event()
    primero_puede_seguir = threading.Event()
    real = CobroCandidato.objects.bulk_create

    def insertar_y_fallar(filas, **extra):
        creadas = real(filas, **extra)
        if threading.current_thread().name == "primero":
            primero_inserto.set()
            assert primero_puede_seguir.wait(ESPERA), "nadie soltó al primero"
            raise RuntimeError("el worker se cae después de insertar")
        return creadas

    monkeypatch.setattr(CobroCandidato.objects, "bulk_create", insertar_y_fallar)

    primero = Hilo("primero", lambda: tasks.procesar_importacion(str(primera.pk)))
    primero.start()
    assert primero_inserto.wait(ESPERA)
    segundo = Hilo("segundo", lambda: tasks.procesar_importacion(str(segunda.pk)))
    segundo.start()
    segundo.join(MARGEN_DE_BLOQUEO)
    assert segundo.is_alive(), "el segundo no se bloqueó"

    primero_puede_seguir.set()
    primero.join(ESPERA)
    assert not primero.is_alive()
    segundo.exigir_que_termino()

    del_1_de_octubre = CobroCandidato.objects.filter(fecha="2026-10-01")
    assert del_1_de_octubre.count() == 1
    assert del_1_de_octubre.get().importacion_id == segunda.pk

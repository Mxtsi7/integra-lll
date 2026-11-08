"""
FE-07 — la purga decide sobre la fila VIGENTE, no sobre la que leyó al empezar.

El hallazgo de la revisión de #120: la purga elegía las importaciones antes
de la transacción, ignoraba que `avanzar_a` perdiera el CAS y borraba el
archivo igual. Si otro proceso reclamaba la importación entre la selección y
la transición, quedaba `procesando` SIN archivo.

Lo que tiene que quedar demostrado:

- reclamada entre la selección y la transición → queda fallida, con el error
  anotado, y recién ahí se borra el archivo (transición persistida coherente);
- terminada mientras la purga preparaba la lista → solo se borra el archivo:
  su estado y sus errores no se tocan;
- si la transición no se puede hacer, no se borra nada;
- si falla el borrado, se revierte también la transición;
- dos purgas no se pisan;
- con dos conexiones PostgreSQL, quien quiera marcar `completada` mientras la
  purga tiene la fila espera, y al soltarse su CAS no pisa nada.
"""

import hashlib
import threading
import time
import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connection, connections
from django.utils import timezone

from connectors.management.commands import purgar_archivos_importacion as purga
from connectors.models import ArchivoImportacion, Importacion

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
ESPERA = 15.0


def con_archivo_vencido(estado=Importacion.Estado.PENDIENTE):
    importacion = Importacion.objects.create(
        organizacion_id=ORG, usuario_id="42",
        origen=Importacion.Origen.CSV, nombre_archivo="cartola.csv",
    )
    if estado != Importacion.Estado.PENDIENTE:
        importacion.avanzar_a(Importacion.Estado.PROCESANDO)
        if estado != Importacion.Estado.PROCESANDO:
            importacion.avanzar_a(estado)
    datos = b"nombre;monto\nNetflix;9990\n"
    ArchivoImportacion.objects.create(
        importacion=importacion, organizacion_id=ORG, formato="csv",
        tamano=len(datos), sha256=hashlib.sha256(datos).hexdigest(),
        contenido=datos, vence_en=timezone.now() - timedelta(hours=1),
    )
    return Importacion.objects.get(pk=importacion.pk)


def tiene_archivo(importacion):
    return ArchivoImportacion.objects.filter(importacion_id=importacion.pk).exists()


def despues_de_seleccionar(monkeypatch, accion):
    """Corre `accion()` justo después de que la purga arma su lista."""
    real = purga.candidatos

    def candidatos(ahora):
        lista = real(ahora)
        accion()
        return lista

    monkeypatch.setattr(purga, "candidatos", candidatos)


def aplicar():
    salida = StringIO()
    call_command("purgar_archivos_importacion", aplicar=True, stdout=salida)
    return salida.getvalue()


@pytest.mark.django_db
class TestIntercaladoEnLaMismaConexion:
    def test_reclamada_entre_la_seleccion_y_la_transicion_queda_fallida_con_su_error(
        self, monkeypatch
    ):
        """La reproducción de la revisión. Antes: procesando y sin archivo."""
        importacion = con_archivo_vencido()
        despues_de_seleccionar(
            monkeypatch,
            lambda: Importacion.objects.filter(pk=importacion.pk).update(
                estado=Importacion.Estado.PROCESANDO
            ),
        )
        salida = aplicar()
        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.FALLIDA
        assert importacion.errores[0]["codigo"] == "archivo_vencido"
        assert not tiene_archivo(importacion)
        assert "1 importacion(es) sin procesar quedaron FALLIDAS" in salida

    def test_terminada_mientras_la_purga_preparaba_conserva_estado_y_errores(
        self, monkeypatch
    ):
        """El procesamiento terminó después de la selección: lo que dejó
        (estado y errores) no se pisa. Solo sobra el archivo."""
        importacion = con_archivo_vencido(estado=Importacion.Estado.PROCESANDO)

        def termina():
            fila = Importacion.objects.get(pk=importacion.pk)
            fila.anotar_error("fila_invalida", "falta el monto", fila=3)
            fila.save(update_fields=["errores", "errores_totales"])
            fila.avanzar_a(Importacion.Estado.COMPLETADA)

        despues_de_seleccionar(monkeypatch, termina)
        salida = aplicar()
        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.COMPLETADA
        assert importacion.errores_totales == 1
        assert importacion.errores[0]["codigo"] == "fila_invalida"
        assert not tiene_archivo(importacion)
        assert "1 ya estaban terminadas" in salida

    def test_si_la_transicion_no_se_puede_hacer_no_se_borra_nada(self, monkeypatch):
        importacion = con_archivo_vencido()
        monkeypatch.setattr(Importacion, "avanzar_a", lambda self, estado, **kw: False)
        salida = aplicar()
        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.PENDIENTE
        assert importacion.errores_totales == 0, "el error anotado no se revirtió"
        assert tiene_archivo(importacion)
        assert "1 se omitieron" in salida

    def test_si_falla_el_borrado_se_revierte_la_transicion(self, monkeypatch):
        importacion = con_archivo_vencido()

        def falla(self, *a, **k):
            raise RuntimeError("se cayó el borrado")

        monkeypatch.setattr(ArchivoImportacion, "delete", falla)
        with pytest.raises(RuntimeError):
            aplicar()
        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.PENDIENTE
        assert importacion.errores_totales == 0
        assert tiene_archivo(importacion)

    def test_dos_purgas_seguidas_no_se_pisan(self):
        importacion = con_archivo_vencido()
        lista = purga.candidatos(timezone.now())
        primera = [purga.purgar_uno(a, i, timezone.now()) for a, i in lista]
        segunda = [purga.purgar_uno(a, i, timezone.now()) for a, i in lista]
        assert primera == [purga.FALLIDA]
        assert segunda == [purga.YA_NO_ESTABA]
        importacion.refresh_from_db()
        assert importacion.errores_totales == 1, "la segunda anotó el error otra vez"

    def test_un_vencimiento_renovado_despues_de_seleccionar_no_se_borra(self, monkeypatch):
        importacion = con_archivo_vencido()
        despues_de_seleccionar(
            monkeypatch,
            lambda: ArchivoImportacion.objects.filter(importacion_id=importacion.pk).update(
                vence_en=timezone.now() + timedelta(days=7)
            ),
        )
        aplicar()
        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.PENDIENTE
        assert tiene_archivo(importacion)

    def test_la_decision_se_toma_con_la_fila_bloqueada(self):
        """Si alguien saca el FOR UPDATE, esto falla."""
        import inspect

        fuente = inspect.getsource(purga.purgar_uno)
        assert fuente.count("select_for_update()") == 2
        assert fuente.index("select_for_update()") < fuente.index("importacion.terminada")


# ══════════════════════════════════════════════════════════════════════
# Dos conexiones PostgreSQL de verdad
# ══════════════════════════════════════════════════════════════════════


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
        self.termino = threading.Event()

    def run(self):
        try:
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connections.close_all()
            self.termino.set()


def esperando_un_lock(nombre_aplicacion_ignorado=None) -> int:
    """Cuántas sesiones de esta base están esperando un lock ahora."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_stat_activity "
            "WHERE datname = current_database() AND wait_event_type = 'Lock'"
        )
        return cursor.fetchone()[0]


@pytest.mark.django_db(transaction=True)
class TestDosConexiones:
    def test_el_procesamiento_espera_a_la_purga_y_su_CAS_no_pisa_nada(
        self, solo_postgres, monkeypatch
    ):
        importacion = con_archivo_vencido(estado=Importacion.Estado.PROCESANDO)
        purga_dentro = threading.Event()
        puede_seguir = threading.Event()
        real = Importacion.anotar_error

        def anotar_y_detenerse(self, *a, **k):
            # Se llama con la importación y el archivo YA bloqueados.
            real(self, *a, **k)
            if threading.current_thread().name == "PURGA":
                purga_dentro.set()
                assert puede_seguir.wait(ESPERA), "nadie soltó la purga"

        monkeypatch.setattr(Importacion, "anotar_error", anotar_y_detenerse)

        hilo_purga = Hilo("PURGA", lambda: purga.purgar_uno(
            ArchivoImportacion.objects.get(importacion_id=importacion.pk).pk,
            importacion.pk, timezone.now(),
        ))
        hilo_worker = Hilo("WORKER", lambda: Importacion.objects.filter(
            pk=importacion.pk, estado=Importacion.Estado.PROCESANDO,
        ).update(estado=Importacion.Estado.COMPLETADA))
        try:
            hilo_purga.start()
            assert purga_dentro.wait(ESPERA), "la purga no llegó a bloquear"
            hilo_worker.start()
            limite = time.monotonic() + ESPERA
            while esperando_un_lock() < 1:
                assert not hilo_worker.termino.is_set(), "el worker no esperó a la purga"
                assert time.monotonic() < limite, "el worker nunca quedó esperando"
                time.sleep(0.02)
        finally:
            puede_seguir.set()
            hilo_purga.join(ESPERA)
            hilo_worker.join(ESPERA)

        assert hilo_purga.error is None, hilo_purga.error
        assert hilo_worker.error is None, hilo_worker.error
        assert hilo_purga.resultado == purga.FALLIDA
        assert hilo_worker.resultado == 0, "el CAS del worker pisó la transición de la purga"
        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.FALLIDA
        assert not tiene_archivo(importacion)

    def test_dos_purgas_a_la_vez_la_segunda_espera_y_no_encuentra_nada(
        self, solo_postgres, monkeypatch
    ):
        importacion = con_archivo_vencido()
        archivo_pk = ArchivoImportacion.objects.get(importacion_id=importacion.pk).pk
        primera_dentro = threading.Event()
        puede_seguir = threading.Event()
        real = Importacion.anotar_error

        def anotar_y_detenerse(self, *a, **k):
            real(self, *a, **k)
            if threading.current_thread().name == "A":
                primera_dentro.set()
                assert puede_seguir.wait(ESPERA), "nadie soltó la primera"

        monkeypatch.setattr(Importacion, "anotar_error", anotar_y_detenerse)
        a = Hilo("A", lambda: purga.purgar_uno(archivo_pk, importacion.pk, timezone.now()))
        b = Hilo("B", lambda: purga.purgar_uno(archivo_pk, importacion.pk, timezone.now()))
        try:
            a.start()
            assert primera_dentro.wait(ESPERA)
            b.start()
            limite = time.monotonic() + ESPERA
            while esperando_un_lock() < 1:
                assert not b.termino.is_set(), "la segunda purga no esperó"
                assert time.monotonic() < limite
                time.sleep(0.02)
        finally:
            puede_seguir.set()
            a.join(ESPERA)
            b.join(ESPERA)
        assert a.error is None and b.error is None, (a.error, b.error)
        assert (a.resultado, b.resultado) == (purga.FALLIDA, purga.YA_NO_ESTABA)
        importacion.refresh_from_db()
        assert importacion.errores_totales == 1

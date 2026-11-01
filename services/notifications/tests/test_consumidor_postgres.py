"""Intercalados reales: dos conexiones; SQLite no acredita estos bloqueos."""
import json
import threading
import queue
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection, connections

from notifications import consumo
from notifications.models import EventoRecibido, SuscripcionVigilada
from shared.borrado.models import EstadoOrganizacion
from tests.test_eliminacion_proyeccion import limpiar, SECRETO
from tests.test_proyeccion import sobre

pytestmark = pytest.mark.django_db(transaction=True)


def test_dos_entregas_concurrentes_deduplican():
    if connection.vendor != 'postgresql':
        pytest.skip('requiere dos conexiones PostgreSQL')
    org = uuid.uuid4()
    EstadoOrganizacion.objects.create(organizacion_id=org)
    mensaje = json.dumps(sobre(org=str(org))).encode()
    barrera = threading.Barrier(2)
    def recibir():
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
            barrera.wait(timeout=5)
            return consumo.recibir(mensaje)
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        futuros = [pool.submit(recibir) for _ in range(2)]
        assert sorted(f.result(timeout=10) for f in futuros) == [False, True]
    assert EventoRecibido.objects.count() == 1
    assert SuscripcionVigilada.objects.count() == 1


def test_limpieza_espera_ingesta_y_borra_inbox_y_proyeccion(monkeypatch):
    if connection.vendor != 'postgresql':
        pytest.skip('requiere dos conexiones PostgreSQL')
    monkeypatch.setenv('ELIMINACION_INTERNA_SECRET', SECRETO)
    org = uuid.uuid4()
    EstadoOrganizacion.objects.create(organizacion_id=org)
    mensaje = json.dumps(sobre(org=str(org))).encode()
    escrito, liberar = threading.Event(), threading.Event()
    pid_limpieza = queue.Queue()
    original = consumo.aplicar
    def retener(sobre_):
        resultado = original(sobre_)
        escrito.set()
        assert liberar.wait(timeout=10)
        return resultado
    monkeypatch.setattr(consumo, 'aplicar', retener)
    def ingerir():
        try:
            return consumo.recibir(mensaje)
        finally:
            connections.close_all()
    def borrar():
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '8s'")
            def observar(execute, sql, params, many, context):
                if 'FOR UPDATE' in sql:
                    pid_limpieza.put(connection.connection.info.backend_pid)
                return execute(sql, params, many, context)
            with connection.execute_wrapper(observar):
                return limpiar(org).status_code
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        ingesta = pool.submit(ingerir)
        try:
            assert escrito.wait(timeout=5)
            limpieza = pool.submit(borrar)
            pid = pid_limpieza.get(timeout=5)
            limite = time.monotonic() + 5
            while True:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT cardinality(pg_blocking_pids(%s))', [pid])
                    bloqueada = cursor.fetchone()[0] > 0
                if bloqueada:
                    break
                assert time.monotonic() < limite, 'DELETE no esperó el commit de ingesta'
                time.sleep(.02)
        finally:
            liberar.set()
        assert ingesta.result(timeout=10)
        assert limpieza.result(timeout=10) == 204
    assert not EventoRecibido.objects.filter(organizacion_id=org).exists()
    assert not SuscripcionVigilada.objects.filter(organizacion_id=org).exists()
    assert not consumo.recibir(mensaje)

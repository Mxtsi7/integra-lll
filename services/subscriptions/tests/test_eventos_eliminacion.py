"""Una entrega tardía o en vuelo no puede sobrevivir al ACK del borrado."""

import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.db import close_old_connections, connection
from django.db.utils import OperationalError
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from app.management.commands import consumir_eventos
from app.models import ResumenOrganizacion, Subscription, TrabajoDerivado
from events import trabajo
from events.outbox import registrar_creada
from events.publicador import crear_payload
from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion


pytestmark = pytest.mark.django_db


def crear(org):
    return Subscription.objects.create(
        organizacion_id=org, nombre="Servicio", monto=1000, moneda="CLP",
        frecuencia="mensual", fecha_proximo_cobro=date(2026, 11, 1), estado="activo",
    )


def limpiar(org):
    operacion = uuid.uuid4()
    cabeceras = cabeceras_eliminacion("subscriptions", org, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in cabeceras.items()},
    ).status_code


class Canal:
    def __init__(self, org):
        self.org = org
        self.confirmaciones = []
        self.rechazos = []

    def basic_ack(self, *, delivery_tag):
        self.confirmaciones.append((
            ResumenOrganizacion.objects.filter(organizacion_id=self.org).count(),
            TrabajoDerivado.objects.filter(organizacion_id=self.org).count(),
        ))

    def basic_reject(self, *, delivery_tag, requeue):
        self.rechazos.append(requeue)


def consumir(org, cuerpo):
    canal = Canal(org)
    resultado = consumir_eventos.Command().atender(canal, SimpleNamespace(delivery_tag=1), cuerpo)
    return resultado, canal


@pytest.mark.parametrize("acreditado", [False, True])
def test_entrega_despues_del_ack_de_borrado_se_omite_sin_recrear(
    monkeypatch, caplog, acreditado,
):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    monkeypatch.setattr(consumir_eventos, "close_old_connections", lambda: None)
    org, otra = uuid.uuid4(), uuid.uuid4()
    evento = registrar_creada(crear(org))
    cuerpo = json.dumps(crear_payload(evento)).encode()
    if acreditado:
        trabajo.recalcular_resumen_por_evento(evento.id, org, hecho_por="api")
    otro_evento = registrar_creada(crear(otra))
    trabajo.recalcular_resumen_por_evento(otro_evento.id, otra, hecho_por="api")

    assert limpiar(org) == 204
    caplog.set_level(logging.INFO, logger=consumir_eventos.__name__)
    for _ in range(2):
        resultado, canal = consumir(org, cuerpo)
        assert resultado.confirmar and not resultado.recalculado
        assert canal.confirmaciones == [(0, 0)] and canal.rechazos == []
    assert "organizacion_eliminada" in caplog.text
    assert "ya_acreditado" not in caplog.text
    assert "resumen.recalculado" not in caplog.text
    assert ResumenOrganizacion.objects.get(organizacion_id=otra).total_mensual == Decimal("1000.00")
    assert TrabajoDerivado.objects.filter(evento_id=otro_evento.id).count() == 1


def test_recalculo_publico_rechaza_tenant_eliminado_aunque_quede_fuente(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    assert limpiar(org) == 204
    # Fuente residual/externa: el recálculo público tampoco puede resucitarla.
    crear(org)
    crear(otra)
    with pytest.raises(PermissionDenied):
        trabajo.recalcular_resumen(org)
    assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()
    assert trabajo.recalcular_resumen(otra)[0].total_mensual == Decimal("1000.00")


@pytest.mark.parametrize("error", [PermissionDenied("fallo del cálculo"), RuntimeError("fallo del cálculo")])
def test_error_real_del_calculo_no_se_confunde_con_evento_obsoleto(monkeypatch, error):
    org = uuid.uuid4()
    evento = registrar_creada(crear(org))
    cuerpo = json.dumps(crear_payload(evento)).encode()

    def fallar(_org):
        raise error

    monkeypatch.setattr(trabajo, "_recalcular_ya_bloqueado", fallar)
    resultado = consumir_eventos.procesar(cuerpo)
    assert not resultado.confirmar and not resultado.recalculado
    assert "fallo del cálculo" in resultado.motivo
    assert not TrabajoDerivado.objects.filter(evento_id=evento.id).exists()
    assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()


def test_fallo_de_base_al_bloquear_se_reintenta_sin_ack(monkeypatch):
    org = uuid.uuid4()
    cuerpo = json.dumps(crear_payload(registrar_creada(crear(org)))).encode()

    def fallar(*_args, **_kwargs):
        raise OperationalError("sin conexión")

    monkeypatch.setattr(trabajo, "bloquear_organizacion", fallar)
    monkeypatch.setattr(consumir_eventos, "close_old_connections", lambda: None)
    esperas = []
    resultado = consumir_eventos.procesar(cuerpo, dormir=esperas.append)
    assert not resultado.confirmar and not resultado.recalculado
    assert esperas == [1, 2]
    assert "base no disponible tras 3 intentos" in resultado.motivo
    assert not TrabajoDerivado.objects.filter(organizacion_id=org).exists()


@pytest.mark.django_db(transaction=True)
def test_borrado_espera_consumidor_en_vuelo_y_su_reentrega_no_resucita(monkeypatch):
    if connection.vendor != "postgresql":
        pytest.skip("la intercalación requiere PostgreSQL")
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    for tenant in (org, otra):
        EstadoOrganizacion.objects.create(organizacion_id=tenant)
    evento = registrar_creada(crear(org))
    cuerpo = json.dumps(crear_payload(evento)).encode()
    otro_evento = registrar_creada(crear(otra))
    trabajo.recalcular_resumen_por_evento(otro_evento.id, otra, hecho_por="api")
    leyo_evidencia, continuar, limpieza_iniciada = (threading.Event() for _ in range(3))
    original = trabajo.ya_acreditado
    pid_limpieza = []

    def pausar_tras_evidencia(evento_id):
        resultado = original(evento_id)
        if str(evento_id) == str(evento.id):
            leyo_evidencia.set()
            assert continuar.wait(10), "el consumidor no fue liberado"
        return resultado

    monkeypatch.setattr(trabajo, "ya_acreditado", pausar_tras_evidencia)

    def en_conexion_nueva(funcion):
        close_old_connections()
        try:
            return funcion()
        finally:
            close_old_connections()

    def borrar():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_backend_pid()")
            pid_limpieza.append(cursor.fetchone()[0])
        limpieza_iniciada.set()
        return limpiar(org)

    with ThreadPoolExecutor(max_workers=2) as pool:
        consumidor = pool.submit(en_conexion_nueva, lambda: consumir(org, cuerpo))
        limpieza = None
        try:
            assert leyo_evidencia.wait(10)
            limpieza = pool.submit(en_conexion_nueva, borrar)
            assert limpieza_iniciada.wait(10)
            limite = time.monotonic() + 10
            esperando = False
            while time.monotonic() < limite:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s",
                        pid_limpieza,
                    )
                    esperando = cursor.fetchone() == ("Lock",)
                if esperando or limpieza.done():
                    break
                time.sleep(0.02)
            assert esperando and not limpieza.done(), "el borrado dio ACK con un consumidor en vuelo"
        finally:
            continuar.set()
            resultado, canal = consumidor.result(timeout=10)
            if limpieza is not None:
                assert limpieza.result(timeout=10) == 204

    assert resultado.confirmar and resultado.recalculado
    # El borrado puede confirmar entre el commit del trabajo y el ACK al broker.
    assert len(canal.confirmaciones) == 1 and canal.rechazos == []
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    assert not Subscription.objects.filter(organizacion_id=org).exists()
    # La nueva entrega atraviesa el mismo consumidor real después del ACK 204.
    resultado, canal = consumir(org, cuerpo)
    assert resultado.confirmar and not resultado.recalculado
    assert canal.confirmaciones == [(0, 0)]
    assert ResumenOrganizacion.objects.get(organizacion_id=otra).total_mensual == Decimal("1000.00")
    assert TrabajoDerivado.objects.filter(evento_id=otro_evento.id).count() == 1

"""Idempotencia y aislamiento de la recepción sobre PostgreSQL real."""

import copy
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from django.conf import settings
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from app.models import EventoUsoRecibido, Subscription

EJEMPLOS = json.loads((Path(__file__).resolve().parents[3] /
    'docs/contratos/uso-recolectores-v1.ejemplos.json').read_text())


@pytest.fixture
def evento():
    return copy.deepcopy(EJEMPLOS['eventos_uso'][0]['evento'])


@pytest.fixture
def destino(db, settings):
    settings.USO_VERIFICAR_CONSENTIMIENTO = lambda **contexto: True
    settings.USO_PERSISTIR_EVENTO = 'app.uso_recolectores.persistencia.persistir'
    return Subscription.objects.create(organizacion_id=uuid4(), nombre='Servicio',
        monto='1000', moneda='CLP', frecuencia='mensual', categoria='streaming',
        fecha_proximo_cobro='2026-11-20')


def enviar(destino, evento, usuario='42', organizacion_id=None):
    organizacion = organizacion_id or destino.organizacion_id
    cabeceras = {'X-Organizacion-Id': str(organizacion), 'X-Usuario-Id': usuario}
    return APIClient().post(f'/api/suscripciones/{destino.id}/uso/recolector/',
        evento, format='json', headers=cabeceras)


def test_persiste_antes_de_aceptar_y_reintento_es_idempotente(destino, evento):
    assert connection.vendor == 'postgresql'
    primera = enviar(destino, evento)
    repetida = enviar(destino, evento)
    assert primera.status_code == 201
    assert repetida.status_code == 200
    assert primera.data['event_id'] == repetida.data['event_id'] == evento['event_id']
    assert primera.data['estado'] == 'aceptado'
    assert primera.data['recibido_en'].endswith('Z')
    assert EventoUsoRecibido.objects.count() == 1
    recibida = EventoUsoRecibido.objects.get()
    assert recibida.suscripcion_id == destino.id
    assert recibida.usuario_id == 42
    assert not recibida.proyeccion_pendiente


def test_misma_clave_con_cuerpo_o_destino_distinto_es_conflicto(destino, evento):
    assert enviar(destino, evento).status_code == 201
    distinto = {**evento, 'cobertura': 'parcial'}
    conflicto_cuerpo = enviar(destino, distinto)
    assert conflicto_cuerpo.status_code == 409
    assert conflicto_cuerpo.data['codigo'] == 'event_id_conflictivo'
    otro_destino = Subscription.objects.create(organizacion_id=destino.organizacion_id,
        nombre='Otro servicio', monto='1000', moneda='CLP', frecuencia='mensual',
        categoria='streaming', fecha_proximo_cobro='2026-11-20')
    assert enviar(otro_destino, evento).status_code == 409
    assert EventoUsoRecibido.objects.count() == 1


def test_clave_pertenece_al_usuario_y_la_organizacion(destino, evento):
    assert enviar(destino, evento, usuario='43').status_code == 201
    otra_organizacion = Subscription.objects.create(organizacion_id=uuid4(), nombre='Ajena',
        monto='1000', moneda='CLP', frecuencia='mensual', categoria='streaming',
        fecha_proximo_cobro='2026-11-20')
    assert enviar(otra_organizacion, evento).status_code == 201
    assert enviar(otra_organizacion, evento, organizacion_id=destino.organizacion_id).status_code == 404
    assert EventoUsoRecibido.objects.count() == 2


def test_consulta_cobertura_conserva_intervalos_y_filtra_usuario(destino, evento):
    assert enviar(destino, evento).status_code == 201
    respuesta = APIClient().get(
        f'/api/suscripciones/{destino.id}/uso/cobertura/?fecha=2026-11-09',
        headers={'X-Organizacion-Id': str(destino.organizacion_id), 'X-Usuario-Id': '42'},
    )
    assert respuesta.status_code == 200
    assert respuesta.data['count'] == 1
    observacion = respuesta.data['results'][0]
    assert observacion['recolector_id'] == evento['recolector_id']
    assert observacion['inicio'] == evento['inicio'].replace('Z', '.000Z')
    assert observacion['fin'] == evento['fin'].replace('Z', '.000Z')
    assert observacion['tramos_actividad'][0]['inicio'] == evento['tramos_actividad'][0]['inicio'].replace('Z', '.000Z')
    assert observacion['tramos_actividad'][0]['fin'] == evento['tramos_actividad'][0]['fin'].replace('Z', '.000Z')
    ajena = APIClient().get(
        f'/api/suscripciones/{destino.id}/uso/cobertura/?fecha=2026-11-09',
        headers={'X-Organizacion-Id': str(destino.organizacion_id), 'X-Usuario-Id': '43'},
    )
    assert ajena.status_code == 200 and ajena.data['count'] == 0


def test_consulta_cobertura_exige_dia_valido(destino):
    respuesta = APIClient().get(
        f'/api/suscripciones/{destino.id}/uso/cobertura/',
        headers={'X-Organizacion-Id': str(destino.organizacion_id), 'X-Usuario-Id': '42'},
    )
    assert respuesta.status_code == 400


@pytest.mark.django_db(transaction=True)
def test_reintentos_concurrentes_crean_un_solo_hecho(destino, evento):
    assert connection.vendor == 'postgresql', 'esta carrera debe correr en PostgreSQL'
    barrera = Barrier(2)

    def publicar():
        close_old_connections()
        try:
            barrera.wait(timeout=5)
            return enviar(destino, evento).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as ejecutores:
        estados = list(ejecutores.map(lambda _: publicar(), range(2)))
    assert sorted(estados) == [200, 201]
    assert EventoUsoRecibido.objects.count() == 1

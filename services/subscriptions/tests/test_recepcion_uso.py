"""Recepción canónica; PostgreSQL real para las pruebas de API/persistencia."""
import copy
import json
from pathlib import Path
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from app.models import Subscription
from app.uso_recolectores.validacion import ErrorEventoUso, validar_evento

EJEMPLOS = json.loads((Path(__file__).resolve().parents[3] /
    'docs/contratos/uso-recolectores-v1.ejemplos.json').read_text())


@pytest.fixture
def evento():
    return copy.deepcopy(EJEMPLOS['eventos_uso'][0]['evento'])


@pytest.mark.parametrize('caso', EJEMPLOS['eventos_uso'], ids=lambda caso: caso['nombre'])
def test_acepta_las_fixtures_del_contrato(caso):
    validado = validar_evento(caso['evento'])
    assert validado.cuerpo['duracion_ms'] == caso['evento']['duracion_ms']
    assert validado.fecha.isoformat() == '2026-11-09'


@pytest.mark.parametrize('campo,valor', [
    ('usuario_id', 42), ('organizacion_id', str(uuid4())), ('suscripcion_id', str(uuid4())),
    ('duracion_ms', -1), ('duracion_ms', 1), ('version', 2), ('origen', 'desconocido'),
    ('zona_horaria', 'Zona/inexistente'), ('estado', 'pausado'),
    ('inicio', '2026-11-09T12:00:00.000001Z'),
    ('fin', '2026-11-11T12:00:00Z'),
])
def test_rechaza_identidad_y_eventos_incompatibles(evento, campo, valor):
    evento[campo] = valor
    with pytest.raises(ErrorEventoUso):
        validar_evento(evento)


def test_normaliza_instantes_y_conserva_milisegundos(evento):
    evento['inicio'] = '2026-11-09T12:00:00.000Z'
    validado = validar_evento(evento)
    assert validado.cuerpo['inicio'] == '2026-11-09T12:00:00.000Z'
    assert validado.cuerpo['duracion_ms'] == 30000


@pytest.fixture
def suscripcion(db):
    return Subscription.objects.create(organizacion_id=uuid4(), nombre='Servicio',
        monto='1000', moneda='CLP', frecuencia='mensual', categoria='streaming',
        fecha_proximo_cobro='2026-11-20')


def enviar(suscripcion, evento, **cabeceras):
    identidad = {'X-Organizacion-Id': str(suscripcion.organizacion_id), 'X-Usuario-Id': '42'}
    identidad.update(cabeceras)
    return APIClient().post(f'/api/suscripciones/{suscripcion.id}/uso/recolector/',
        evento, format='json', headers=identidad)


def test_recepcion_exige_identidad_y_destino_propio(suscripcion, evento):
    assert enviar(suscripcion, evento, **{'X-Usuario-Id': ''}).status_code == 403
    assert enviar(suscripcion, evento, **{'X-Usuario-Id': 'falso'}).status_code == 400
    assert enviar(suscripcion, evento, **{'X-Organizacion-Id': str(uuid4())}).status_code == 404


def test_sin_control_de_consentimiento_no_se_acepta(suscripcion, evento):
    respuesta = enviar(suscripcion, evento)
    assert respuesta.status_code == 403
    assert respuesta.data['codigo'] == 'consentimiento_requerido'


def test_sin_receptor_durable_no_devuelve_aceptacion(suscripcion, evento, settings):
    settings.USO_VERIFICAR_CONSENTIMIENTO = lambda **contexto: True
    respuesta = enviar(suscripcion, evento)
    assert respuesta.status_code == 503
    assert respuesta.data['codigo'] == 'recepcion_no_disponible'


def test_valida_antes_de_invocar_el_receptor(suscripcion, evento, settings):
    settings.USO_VERIFICAR_CONSENTIMIENTO = lambda **contexto: True
    def no_debe_persistir(**contexto):
        pytest.fail('un evento inválido llegó al almacenamiento')
    settings.USO_PERSISTIR_EVENTO = no_debe_persistir
    evento['duracion_ms'] = -1
    assert enviar(suscripcion, evento).status_code == 400

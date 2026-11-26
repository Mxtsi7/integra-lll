from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from app.models import Subscription
from app.uso_recolectores.validacion import validar_evento

pytestmark = pytest.mark.django_db


@pytest.fixture
def destino():
    return Subscription.objects.create(organizacion_id=uuid4(), nombre='Servicio',
        monto='1000', moneda='CLP', frecuencia='mensual', categoria='streaming',
        fecha_proximo_cobro='2026-11-20')


def peticion(destino, recolector, accion=None, usuario='42', organizacion=None):
    cliente = APIClient(headers={'X-Organizacion-Id': str(organizacion or destino.organizacion_id),
                                 'X-Usuario-Id': usuario})
    ruta = f'/api/suscripciones/{destino.id}/uso/consentimiento/'
    if accion is None:
        return cliente.get(ruta, {'recolector_id': str(recolector)})
    return cliente.post(ruta, {'recolector_id': str(recolector), 'origen': 'android',
        'accion': accion, 'version_texto': 'uso-v1'}, format='json')


def instante(hora):
    return datetime.fromisoformat(f'2026-11-25T{hora}+00:00')


def hecho(recolector, inicio, fin):
    return validar_evento(dict(version=1, event_id=str(uuid4()), recolector_id=str(recolector),
        origen='android', inicio=f'2026-11-25T{inicio}Z', fin=f'2026-11-25T{fin}Z',
        duracion_ms=0, tramos_actividad=[], zona_horaria='America/Santiago',
        cobertura='sin_medicion', estado='activo'))


def test_consentimiento_no_se_comparte_entre_usuarios_ni_tenants(destino):
    recolector = uuid4()
    with patch('django.utils.timezone.now', return_value=instante('12:00:00')):
        respuesta = peticion(destino, recolector, 'aceptar')
    assert respuesta.status_code == 200
    assert respuesta.data['estado'] == 'activo'
    assert respuesta.data['zona_horaria'] == 'America/Santiago'
    assert peticion(destino, recolector, usuario='43').status_code == 404
    assert peticion(destino, recolector, organizacion=uuid4()).status_code == 404


def test_pausa_conserva_pendientes_pero_excluye_su_intervalo_y_revocar_es_terminal(destino):
    from app.uso_recolectores.consentimiento import verificar
    recolector = uuid4()
    for hora, accion in [('12:00:00', 'aceptar'), ('12:10:00', 'pausar'), ('12:20:00', 'reanudar')]:
        with patch('django.utils.timezone.now', return_value=instante(hora)):
            assert peticion(destino, recolector, accion).status_code == 200
    contexto = dict(suscripcion=destino, usuario_id=42)
    with patch('django.utils.timezone.now', return_value=instante('12:30:00')):
        assert verificar(**contexto, evento=hecho(recolector, '12:01:00', '12:02:00'))
        assert not verificar(**contexto, evento=hecho(recolector, '12:09:00', '12:21:00'))
        assert not verificar(**contexto, evento=hecho(recolector, '12:11:00', '12:12:00'))
        assert verificar(**contexto, evento=hecho(recolector, '12:21:00', '12:22:00'))
        assert peticion(destino, recolector, 'revocar').status_code == 200
        assert not verificar(**contexto, evento=hecho(recolector, '12:01:00', '12:02:00'))
        assert peticion(destino, recolector, 'reanudar').status_code == 409
        assert peticion(destino, recolector, 'aceptar').status_code == 409


def test_reintentar_aceptacion_no_mueve_el_inicio(destino):
    recolector = uuid4()
    with patch('django.utils.timezone.now', return_value=instante('12:00:00')):
        primera = peticion(destino, recolector, 'aceptar')
    with patch('django.utils.timezone.now', return_value=instante('12:10:00')):
        segunda = peticion(destino, recolector, 'aceptar')
    assert primera.status_code == segunda.status_code == 200
    assert primera.data['desde'] == segunda.data['desde']


def test_validacion_y_falta_de_identidad(destino):
    assert peticion(destino, uuid4(), 'inventar').status_code == 400
    assert peticion(destino, 'no-uuid', 'aceptar').status_code == 400
    assert peticion(destino, uuid4(), 'aceptar', usuario='').status_code == 403


def test_recepcion_real_consentimiento_outbox_idempotencia_y_revocacion(destino):
    from app.models import EventoUsoRecibido, OutboxEvento
    recolector = uuid4()
    with patch('django.utils.timezone.now', return_value=instante('12:00:00')):
        assert peticion(destino, recolector, 'aceptar').status_code == 200
    evento = hecho(recolector, '12:01:00', '12:02:00').cuerpo
    cliente = APIClient(headers={'X-Organizacion-Id': str(destino.organizacion_id), 'X-Usuario-Id': '42'})
    ruta = f'/api/suscripciones/{destino.id}/uso/recolector/'
    with patch('django.utils.timezone.now', return_value=instante('12:03:00')):
        assert cliente.post(ruta, evento, format='json').status_code == 201
        assert cliente.post(ruta, evento, format='json').status_code == 200
        assert EventoUsoRecibido.objects.count() == 1
        assert OutboxEvento.objects.filter(evento='uso.registrado').count() == 1
        assert peticion(destino, recolector, 'revocar').status_code == 200
        assert cliente.post(ruta, evento, format='json').status_code == 403
        assert EventoUsoRecibido.objects.count() == 1


def test_revocar_desconocido_impide_aceptacion_tardia(destino):
    recolector = uuid4()
    assert peticion(destino, recolector, 'revocar').status_code == 200
    assert peticion(destino, recolector, 'aceptar').status_code == 409

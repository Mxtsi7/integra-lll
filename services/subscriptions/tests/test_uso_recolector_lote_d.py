"""Pruebas de integración Lote D (S3-VI-02..06) sobre PostgreSQL real."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from app.models import EventoUsoRecibido, OutboxEvento, Subscription

def _cargar_ejemplos():
    aqui = Path(__file__).resolve()
    candidatos = [Path('/docs/contratos/uso-recolectores-v1.ejemplos.json')]
    for indice in (3, 2, 1):
        if len(aqui.parents) > indice:
            candidatos.append(aqui.parents[indice] / 'docs/contratos/uso-recolectores-v1.ejemplos.json')
    for ruta in candidatos:
        if ruta.exists():
            return json.loads(ruta.read_text(encoding='utf-8'))
    raise FileNotFoundError('No se encontró uso-recolectores-v1.ejemplos.json')


EJEMPLOS = _cargar_ejemplos()
MAX_BYTES_PAYLOAD_USO = 4096


@pytest.fixture
def evento_android():
    return copy.deepcopy(EJEMPLOS['eventos_uso'][0]['evento'])


@pytest.fixture
def evento_navegador():
    return copy.deepcopy(EJEMPLOS['eventos_uso'][1]['evento'])


@pytest.fixture
def destino(db, settings):
    if connection.vendor != 'postgresql':
        pytest.skip('requiere PostgreSQL')
    settings.USO_VERIFICAR_CONSENTIMIENTO = lambda **contexto: True
    settings.USO_PERSISTIR_EVENTO = 'app.uso_recolectores.persistencia.persistir'
    settings.USO_ZONA_HORARIA = 'America/Santiago'
    return Subscription.objects.create(
        organizacion_id=uuid4(),
        nombre='Servicio',
        monto='1000',
        moneda='CLP',
        frecuencia='mensual',
        categoria='streaming',
        fecha_proximo_cobro='2026-11-20',
    )


def enviar(destino, evento, usuario='42', organizacion_id=None):
    org = organizacion_id or destino.organizacion_id
    cliente = APIClient()
    return cliente.post(
        f'/api/suscripciones/{destino.id}/uso/recolector/',
        evento,
        format='json',
        headers={'X-Organizacion-Id': str(org), 'X-Usuario-Id': str(usuario)},
    )


def enviar_raw(destino, cuerpo_bytes, usuario='42'):
    cliente = APIClient()
    return cliente.post(
        f'/api/suscripciones/{destino.id}/uso/recolector/',
        data=cuerpo_bytes,
        content_type='application/json',
        headers={
            'X-Organizacion-Id': str(destino.organizacion_id),
            'X-Usuario-Id': str(usuario),
        },
    )


@pytest.mark.django_db
def test_aceptacion_201_android_con_tramos(destino, evento_android):
    if connection.vendor != 'postgresql':
        pytest.skip('requiere PostgreSQL')
    respuesta = enviar(destino, evento_android)

    assert respuesta.status_code == 201
    assert respuesta.data['event_id'] == evento_android['event_id']
    assert respuesta.data['suscripcion_id'] == str(destino.id)
    assert respuesta.data['estado'] == 'aceptado'
    assert respuesta.data['recibido_en'].endswith('Z')
    assert len(respuesta.data['recibido_en']) >= 20

    assert EventoUsoRecibido.objects.filter(event_id=evento_android['event_id']).count() == 1
    assert OutboxEvento.objects.filter(evento='uso.registrado').count() == 1
    outbox = OutboxEvento.objects.get(evento='uso.registrado')
    assert outbox.datos['event_id'] == evento_android['event_id']
    assert outbox.datos['suscripcion_id'] == str(destino.id)


@pytest.mark.django_db
def test_aceptacion_201_navegador_cero_observado(destino, evento_navegador):
    if connection.vendor != 'postgresql':
        pytest.skip('requiere PostgreSQL')
    respuesta = enviar(destino, evento_navegador)

    assert respuesta.status_code == 201
    assert respuesta.data['estado'] == 'aceptado'
    recibido = EventoUsoRecibido.objects.get(event_id=evento_navegador['event_id'])
    assert recibido.cuerpo['cobertura'] == 'completa'
    assert recibido.cuerpo['duracion_ms'] == 0
    assert recibido.cuerpo['tramos_actividad'] == []
    assert OutboxEvento.objects.filter(evento='uso.registrado').count() == 1


@pytest.mark.django_db
def test_reintento_identico_devuelve_200_duplicado_sin_repetir_efectos(destino, evento_android):
    if connection.vendor != 'postgresql':
        pytest.skip('requiere PostgreSQL')
    primera = enviar(destino, evento_android)
    segunda = enviar(destino, evento_android)

    assert primera.status_code == 201
    assert segunda.status_code == 200
    assert segunda.data['estado'] == 'duplicado'
    assert segunda.data['event_id'] == primera.data['event_id']
    assert segunda.data['suscripcion_id'] == primera.data['suscripcion_id']
    assert segunda.data['recibido_en'] == primera.data['recibido_en']
    assert EventoUsoRecibido.objects.count() == 1
    assert OutboxEvento.objects.filter(evento='uso.registrado').count() == 1


@pytest.mark.django_db
def test_conflicto_mismo_evento_cuerpo_distinto_devuelve_409(destino, evento_android):
    if connection.vendor != 'postgresql':
        pytest.skip('requiere PostgreSQL')
    assert enviar(destino, evento_android).status_code == 201
    conflicto = copy.deepcopy(evento_android)
    conflicto['duracion_ms'] = 0
    conflicto['tramos_actividad'] = []

    respuesta = enviar(destino, conflicto)

    assert respuesta.status_code == 409
    assert respuesta.data['codigo'] == 'event_id_conflictivo'
    assert EventoUsoRecibido.objects.count() == 1
    assert OutboxEvento.objects.filter(evento='uso.registrado').count() == 1


@pytest.mark.django_db(transaction=True)
def test_carrera_concurrente_mismo_event_id_un_solo_registro(destino, evento_android):
    if connection.vendor != 'postgresql':
        pytest.skip('esta carrera debe correr en PostgreSQL')
    barrera = Barrier(2)

    def publicar():
        close_old_connections()
        try:
            barrera.wait(timeout=5)
            return enviar(destino, evento_android).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as ejecutor:
        estados = list(ejecutor.map(lambda _: publicar(), range(2)))

    assert sorted(estados) == [200, 201]
    assert EventoUsoRecibido.objects.count() == 1
    assert OutboxEvento.objects.filter(evento='uso.registrado').count() == 1


@pytest.mark.django_db
def test_suscripcion_ajena_responde_404_sin_revelar_evento(destino, evento_android, settings):
    otra_org = uuid4()
    destino_ajeno = Subscription.objects.create(
        organizacion_id=otra_org,
        nombre='Ajena',
        monto='1000',
        moneda='CLP',
        frecuencia='mensual',
        categoria='streaming',
        fecha_proximo_cobro='2026-11-20',
    )
    # Pre-crear evento en el tenant ajeno con la misma clave lógica para verificar que no se revela.
    EventoUsoRecibido.objects.create(
        organizacion_id=otra_org,
        usuario_id=42,
        recolector_id=evento_android['recolector_id'],
        event_id=evento_android['event_id'],
        suscripcion=destino_ajeno,
        cuerpo=evento_android,
        inicio='2026-11-09T12:00:00Z',
        fin='2026-11-09T12:02:00Z',
        fecha_local='2026-11-09',
        correlation_id=uuid4(),
        proyeccion_pendiente=False,
    )

    respuesta = enviar(destino_ajeno, evento_android, organizacion_id=destino.organizacion_id)

    assert respuesta.status_code == 404
    cuerpo = respuesta.data if isinstance(respuesta.data, dict) else {}
    assert 'event_id_conflictivo' != cuerpo.get('codigo')
    assert 'duplicado' != cuerpo.get('estado')


@pytest.mark.django_db
def test_rechaza_usuario_id_en_cuerpo(destino, evento_android):
    evento_android['usuario_id'] = '42'
    respuesta = enviar(destino, evento_android)

    assert respuesta.status_code in (400, 422)
    assert EventoUsoRecibido.objects.count() == 0


@pytest.mark.django_db
def test_rechaza_cruce_de_dia_local(destino, evento_android):
    evento_android.update({
        'inicio': '2026-11-09T12:00:00Z',
        'fin': '2026-11-10T12:00:00Z',
        'duracion_ms': 30000,
        'tramos_actividad': [{'inicio': '2026-11-09T12:00:00Z', 'fin': '2026-11-09T12:00:30Z'}],
    })
    respuesta = enviar(destino, evento_android)

    assert respuesta.status_code in (400, 422)
    assert respuesta.data['codigo'] == 'intervalo_cruza_dia_local'


@pytest.mark.django_db
def test_rechaza_duracion_ms_distinta_a_suma_tramos(destino, evento_android):
    evento_android['duracion_ms'] = 60000
    respuesta = enviar(destino, evento_android)

    assert respuesta.status_code in (400, 422)
    assert respuesta.data['codigo'] == 'detalle_actividad_invalido'


@pytest.mark.django_db
def test_rechaza_tramo_fuera_de_ventana(destino, evento_android):
    evento_android['tramos_actividad'] = [{'inicio': '2026-11-09T11:59:50Z', 'fin': '2026-11-09T12:00:20Z'}]
    evento_android['duracion_ms'] = 30000
    respuesta = enviar(destino, evento_android)

    assert respuesta.status_code in (400, 422)
    assert respuesta.data['codigo'] == 'detalle_actividad_invalido'


@pytest.mark.django_db
def test_rechaza_zona_iana_invalida(destino, evento_android):
    evento_android['zona_horaria'] = 'Marte/Olympus'
    respuesta = enviar(destino, evento_android)

    assert respuesta.status_code in (400, 422)


@pytest.mark.django_db
def test_rechaza_payload_mayor_a_4kib(destino, evento_android):
    relleno = 'x' * (MAX_BYTES_PAYLOAD_USO + 1)
    cuerpo = json.dumps(evento_android).encode('utf-8')
    # Asegurar que excede 4KiB enviando bytes crudos con relleno en un campo no válido no sirve
    # porque schema rechaza; enviamos un JSON grande válido en estructura de tamaño por padding en texto.
    evento_grande = copy.deepcopy(evento_android)
    evento_grande['zona_horaria'] = 'America/Santiago'  # válida
    # inflar con espacios en JSON crudo: construir payload > 4096 bytes
    base = json.dumps(evento_grande, separators=(',', ':'))
    padding_len = MAX_BYTES_PAYLOAD_USO + 1 - len(base.encode('utf-8'))
    if padding_len < 0:
        padding_len = 1
    # insertar espacios después de la primera llave para superar el límite manteniendo JSON parseable
    raw = '{' + (' ' * padding_len) + base[1:]
    assert len(raw.encode('utf-8')) > MAX_BYTES_PAYLOAD_USO
    respuesta = enviar_raw(destino, raw.encode('utf-8'))

    assert respuesta.status_code in (400, 413, 422)
    assert EventoUsoRecibido.objects.count() == 0

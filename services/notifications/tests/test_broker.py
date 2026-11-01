"""Recorrido con RabbitMQ real; solo URL de servidor desechable de pruebas."""
import json
import os
import time
from types import SimpleNamespace

import pika
import pytest

from events.topologia import COLA_DOMINIO, COLA_FALLIDOS, EXCHANGE, declarar
from notifications.management.commands.consumir_eventos import Command
from notifications.models import EventoRecibido, SuscripcionVigilada
from tests.test_proyeccion import sobre

pytestmark = pytest.mark.django_db(transaction=True)


def test_routing_v2_reentrega_y_dlq_aislada():
    url = os.getenv('RABBITMQ_PRUEBA_URL')
    if not url:
        pytest.skip('requiere RabbitMQ desechable: RABBITMQ_PRUEBA_URL')
    conexion = pika.BlockingConnection(pika.URLParameters(url))
    try:
        canal = conexion.channel()
        declarar(canal)
        # Cola testigo en el DLX de Subscriptions: un fallo nuestro no debe ir allí.
        canal.exchange_declare(exchange='suscripciones.fallidos', exchange_type='fanout', durable=True)
        testigo = canal.queue_declare(queue='', exclusive=True).method.queue
        canal.queue_bind(exchange='suscripciones.fallidos', queue=testigo)
        canal.confirm_delivery()
        mensaje = sobre()
        cuerpo = json.dumps(mensaje).encode()
        canal.basic_publish(exchange=EXCHANGE, routing_key='suscripcion.creada.v2',
                            body=cuerpo, mandatory=True, properties=pika.BasicProperties(delivery_mode=2))
        for _ in range(50):
            metodo, _, recibido = canal.basic_get(COLA_DOMINIO, auto_ack=False)
            if metodo:
                break
            conexion.sleep(.1)
        assert metodo, 'el productor publicó pero el consumidor no recibió el evento v2'
        assert recibido == cuerpo
        # Simular corte antes de procesar: la reentrega sigue disponible.
        canal.basic_nack(delivery_tag=metodo.delivery_tag, requeue=True)
        metodo, _, recibido = canal.basic_get(COLA_DOMINIO, auto_ack=False)
        assert metodo.redelivered
        Command().atender(canal, metodo, recibido)
        assert EventoRecibido.objects.count() == 1
        assert SuscripcionVigilada.objects.count() == 1
        # Corte entre commit y ACK se representa publicando otra entrega del mismo id.
        canal.basic_publish(exchange=EXCHANGE, routing_key='suscripcion.creada.v2', body=cuerpo, mandatory=True)
        metodo, _, recibido = canal.basic_get(COLA_DOMINIO, auto_ack=False)
        Command().atender(canal, metodo, recibido)
        assert EventoRecibido.objects.count() == 1
        canal.basic_publish(exchange=EXCHANGE, routing_key='suscripcion.creada.v2', body=b'no-json', mandatory=True)
        metodo, _, recibido = canal.basic_get(COLA_DOMINIO, auto_ack=False)
        Command().atender(canal, metodo, recibido)
        for _ in range(50):
            metodo, _, recibido = canal.basic_get(COLA_FALLIDOS, auto_ack=True)
            if metodo:
                break
            conexion.sleep(.1)
        assert metodo and recibido == b'no-json'
        assert canal.basic_get(testigo, auto_ack=True)[0] is None
    finally:
        conexion.close()


@pytest.fixture
def broker_limpio():
    url = os.getenv('RABBITMQ_PRUEBA_URL')
    if not url:
        pytest.skip('requiere RabbitMQ desechable: RABBITMQ_PRUEBA_URL')
    conexion = pika.BlockingConnection(pika.URLParameters(url))
    canal = conexion.channel()
    # Solo el broker DESECHABLE de pruebas; jamás usar RABBITMQ_URL aquí.
    for cola in (COLA_DOMINIO, COLA_FALLIDOS):
        canal.queue_delete(queue=cola)
    try:
        yield conexion, canal
    finally:
        if conexion.is_open:
            if not canal.is_open:
                canal = conexion.channel()
            for cola in (COLA_DOMINIO, COLA_FALLIDOS):
                canal.queue_delete(queue=cola)
            conexion.close()


def obtener(conexion, canal, cola):
    for _ in range(50):
        metodo, propiedades, cuerpo = canal.basic_get(queue=cola, auto_ack=False)
        if metodo:
            return metodo, propiedades, cuerpo
        conexion.sleep(.1)
    pytest.fail(f'no llegó un mensaje a {cola}')


def test_caida_de_bd_dlq_y_replay_con_efecto_unico(broker_limpio, monkeypatch):
    from django.db.utils import OperationalError
    import notifications.management.commands.consumir_eventos as consumo
    from notifications.management.commands.reprocesar_fallidos import reenviar
    conexion, canal = broker_limpio
    declarar(canal)
    canal.confirm_delivery()
    sobre_ = sobre()
    mensaje = json.dumps(sobre_).encode()
    propiedades = pika.BasicProperties(delivery_mode=2, message_id=sobre_['id'],
                                      correlation_id=sobre_['correlation_id'])
    canal.basic_publish(exchange=EXCHANGE, routing_key='suscripcion.creada.v2',
                        body=mensaje, properties=propiedades, mandatory=True)
    metodo, _, recibido = obtener(conexion, canal, COLA_DOMINIO)
    def base_caida(_):
        raise OperationalError('base temporalmente caída')
    with monkeypatch.context() as parche:
        parche.setattr(consumo, 'recibir', base_caida)
        parche.setattr(consumo.time, 'sleep', lambda _: None)
        Command().atender(canal, metodo, recibido)
    assert EventoRecibido.objects.count() == 0
    # Esperar el DLX asíncrono sin confirmar ni descartar el mensaje.
    metodo, _, recibido = obtener(conexion, canal, COLA_FALLIDOS)
    canal.basic_nack(delivery_tag=metodo.delivery_tag, requeue=True)
    assert reenviar(canal, 1) == 1
    metodo, propiedades, recibido = obtener(conexion, canal, COLA_DOMINIO)
    assert propiedades.message_id == sobre_['id']
    assert propiedades.correlation_id == sobre_['correlation_id']
    assert recibido == mensaje
    Command().atender(canal, metodo, recibido)
    # Replay tras ACK perdido: ni inbox ni proyección se duplican.
    canal.basic_publish(exchange='', routing_key=COLA_FALLIDOS,
                        body=mensaje, properties=propiedades, mandatory=True)
    assert reenviar(canal, 1) == 1
    metodo, _, recibido = obtener(conexion, canal, COLA_DOMINIO)
    Command().atender(canal, metodo, recibido)
    assert EventoRecibido.objects.count() == 1
    assert SuscripcionVigilada.objects.count() == 1
    assert canal.queue_declare(queue=COLA_FALLIDOS, passive=True).method.message_count == 0


@pytest.mark.parametrize('tope', ['mensajes', 'bytes'])
def test_limite_rechaza_nuevos_sin_borrar_antiguos(broker_limpio, monkeypatch, tope):
    import events.topologia as topologia
    conexion, canal = broker_limpio
    monkeypatch.setattr(topologia, 'MAX_MENSAJES', 1 if tope == 'mensajes' else 1000)
    monkeypatch.setattr(topologia, 'MAX_BYTES', 1 if tope == 'bytes' else 4 * 1024 * 1024)
    declarar(canal)
    canal.confirm_delivery()
    canal.basic_publish(exchange=EXCHANGE, routing_key='suscripcion.creada.v2', body=b'1', mandatory=True)
    with pytest.raises(pika.exceptions.NackError):
        canal.basic_publish(exchange=EXCHANGE, routing_key='suscripcion.creada.v2', body=b'2', mandatory=True)
    metodo, _, cuerpo = obtener(conexion, canal, COLA_DOMINIO)
    assert cuerpo == b'1'
    canal.basic_ack(delivery_tag=metodo.delivery_tag)
    assert canal.basic_get(COLA_DOMINIO, auto_ack=True)[0] is None
    assert canal.basic_get(COLA_FALLIDOS, auto_ack=True)[0] is None

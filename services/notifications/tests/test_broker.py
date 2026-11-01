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

"""Topología exclusiva de Notificaciones; no comparte DLX con Subscriptions."""
from notifications.proyeccion import EVENTOS_QUE_ESCUCHA

EXCHANGE = 'suscripciones'
COLA_DOMINIO = 'notifications.dominio.v2'
EXCHANGE_FALLIDOS = 'notifications.fallidos'
COLA_FALLIDOS = 'notifications.fallidos'
PATRONES_DOMINIO = tuple(f'{evento}.v2' for evento in EVENTOS_QUE_ESCUCHA)


def declarar(canal):
    canal.exchange_declare(exchange=EXCHANGE, exchange_type='topic', durable=True)
    canal.exchange_declare(exchange=EXCHANGE_FALLIDOS, exchange_type='fanout', durable=True)
    canal.queue_declare(queue=COLA_FALLIDOS, durable=True)
    canal.queue_bind(exchange=EXCHANGE_FALLIDOS, queue=COLA_FALLIDOS)
    canal.queue_declare(queue=COLA_DOMINIO, durable=True,
                        arguments={'x-dead-letter-exchange': EXCHANGE_FALLIDOS})
    for patron in PATRONES_DOMINIO:
        canal.queue_bind(exchange=EXCHANGE, queue=COLA_DOMINIO, routing_key=patron)

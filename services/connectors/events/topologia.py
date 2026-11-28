"""Topología de las dos colas que cruza connectors con Suscripciones.

La de `candidato.confirmado` la declara quien publica (connectors); la de
`candidato.aplicado` la declara quien la consume (connectors), con el mismo
patrón: exchange durable, cola durable, DLX propio y enlace a la versión
exacta del contrato.

El publicador declara exchange, cola y enlace antes de publicar: un exchange
`topic` sin cola enlazada descarta el mensaje, y con `mandatory=True` eso
llega como `UnroutableError`. Declarar es idempotente y la cola es durable,
así que los eventos publicados antes de que arranque el consumidor esperan en
ella. La DLQ es propia de este flujo: no mezcla sus fallos con los del
resumen de MX-21 v2.
"""

from events.contrato import (
    COLA,
    COLA_APLICACIONES,
    COLA_FALLIDOS,
    COLA_FALLIDOS_APLICACIONES,
    EVENTO,
    EVENTO_APLICADO,
    EXCHANGE,
    EXCHANGE_FALLIDOS,
    EXCHANGE_FALLIDOS_APLICACIONES,
    VERSION,
    VERSION_APLICADO,
    routing_key,
)


class _Clave:
    evento = EVENTO
    version = VERSION


def declarar(canal) -> None:
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    canal.exchange_declare(
        exchange=EXCHANGE_FALLIDOS, exchange_type="fanout", durable=True
    )
    canal.queue_declare(queue=COLA_FALLIDOS, durable=True)
    canal.queue_bind(exchange=EXCHANGE_FALLIDOS, queue=COLA_FALLIDOS)
    canal.queue_declare(
        queue=COLA,
        durable=True,
        arguments={"x-dead-letter-exchange": EXCHANGE_FALLIDOS},
    )
    canal.queue_bind(exchange=EXCHANGE, queue=COLA, routing_key=routing_key(_Clave))


class _ClaveAplicado:
    evento = EVENTO_APLICADO
    version = VERSION_APLICADO


def declarar_aplicaciones(canal) -> None:
    """Declara la cola del acuse y su DLQ. Idempotente y durable."""
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    canal.exchange_declare(
        exchange=EXCHANGE_FALLIDOS_APLICACIONES, exchange_type="fanout", durable=True
    )
    canal.queue_declare(queue=COLA_FALLIDOS_APLICACIONES, durable=True)
    canal.queue_bind(
        exchange=EXCHANGE_FALLIDOS_APLICACIONES,
        queue=COLA_FALLIDOS_APLICACIONES,
    )
    canal.queue_declare(
        queue=COLA_APLICACIONES,
        durable=True,
        arguments={"x-dead-letter-exchange": EXCHANGE_FALLIDOS_APLICACIONES},
    )
    canal.queue_bind(
        exchange=EXCHANGE,
        queue=COLA_APLICACIONES,
        routing_key=routing_key(_ClaveAplicado),
    )

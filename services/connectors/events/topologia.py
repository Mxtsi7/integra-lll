"""Topología de la cola de confirmaciones. La declara quien publica.

El publicador declara exchange, cola y enlace antes de publicar: un exchange
`topic` sin cola enlazada descarta el mensaje, y con `mandatory=True` eso
llega como `UnroutableError`. Declarar es idempotente y la cola es durable,
así que los eventos publicados antes de que arranque el consumidor esperan en
ella. La DLQ es propia de este flujo: no mezcla sus fallos con los del
resumen de MX-21 v2.
"""

from events.contrato import (
    COLA,
    COLA_FALLIDOS,
    EVENTO,
    EXCHANGE,
    EXCHANGE_FALLIDOS,
    VERSION,
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

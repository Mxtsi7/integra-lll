"""`candidato.aplicado` v1: lo que subscriptions hizo con una orden de cobro.

Es la vuelta de `candidato.confirmado` (RF-14). connectors publica la orden y,
sin esto, lo único que sabe es que la publicó: no si subscriptions la aplicó
ni si la apartó a su cola de fallos. La web tenía que decir «orden enviada:
revisa Suscripciones», que es verdad pero no es el resultado. La revisión de
#242 lo pidió: un resultado correlacionado e idempotente.

    resultado   motivo              cuándo
    aplicado    cobro_creado        se registró el cobro (y la suscripción, si no había)
    aplicado    sin_cobro           aviso o pago fallido: suscripción sí, cobro no
    fallido     contrato_invalido   el sobre no cumple `candidato.confirmado` v1
    fallido     no_aplicable        cumple, pero aplicarlo lanzó y reintentar no lo arregla

── Qué NO se contesta ────────────────────────────────────────────────────────
  · La base de subscriptions caída tras todos los reintentos: el mensaje va a
    la cola de fallos, pero sin base no hay dónde dejar la respuesta. La orden
    queda «enviada», que sigue siendo verdad.
  · La organización eliminada: connectors también la está borrando.

── Correlación e idempotencia ────────────────────────────────────────────────
`datos.orden_id` es el `id` del sobre de la orden y `correlation_id` es el
mismo de ella. subscriptions escribe la respuesta en su outbox en la MISMA
transacción que aplica la orden, así que una reentrega (que no aplica nada)
no escribe otra. connectors la guarda una vez: un `aplicado` pisa un
`fallido` (alguien reprocesó la cola de fallos y esta vez salió), un `fallido`
nunca pisa nada.

── Exchange propio, como `connectors.eventos` ────────────────────────────────
`suscripciones` es el exchange de los hechos de suscripción y lo escuchan
analytics y notifications. Esto es una respuesta para connectors y nadie más,
así que va por `suscripciones.ordenes`. La cola es de connectors y la declaran
los dos lados (ver `candidato_confirmado`: el publicador no sabe si el
consumidor ya arrancó).
"""

from __future__ import annotations

from . import _validacion

EVENTO = "candidato.aplicado"
VERSION = 1

EXCHANGE = "suscripciones.ordenes"
ROUTING_KEY = f"{EVENTO}.v{VERSION}"
COLA = "connectors.candidatos.resultados"

EXCHANGE_FALLIDOS = "suscripciones.ordenes.fallidos"
COLA_FALLIDOS = "connectors.candidatos.resultados.fallidos"

APLICADO = "aplicado"
FALLIDO = "fallido"

COBRO_CREADO = "cobro_creado"
SIN_COBRO = "sin_cobro"
CONTRATO_INVALIDO = "contrato_invalido"
NO_APLICABLE = "no_aplicable"

_ESQUEMA = "candidato-aplicado-v1.schema.json"


def declarar(canal) -> None:
    """Deja exchange, cola, enlace y cola de fallos listos. Idempotente."""
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    canal.exchange_declare(exchange=EXCHANGE_FALLIDOS, exchange_type="fanout", durable=True)
    canal.queue_declare(queue=COLA_FALLIDOS, durable=True)
    canal.queue_bind(exchange=EXCHANGE_FALLIDOS, queue=COLA_FALLIDOS)
    canal.queue_declare(
        queue=COLA,
        durable=True,
        arguments={"x-dead-letter-exchange": EXCHANGE_FALLIDOS},
    )
    canal.queue_bind(exchange=EXCHANGE, queue=COLA, routing_key=ROUTING_KEY)


def esquema() -> dict:
    return _validacion.esquema(_ESQUEMA)


def errores(sobre) -> list[str]:
    """Los incumplimientos del contrato, todos y en texto. Vacío si cumple."""
    return _validacion.errores(_ESQUEMA, sobre)

"""`candidato.confirmado` v1: lo que connectors publica y subscriptions aplica.

Es la orden de cobro de RF-14. Una persona confirmó un cobro candidato (de un
CSV o de un correo) y connectors dejó en su outbox, en la misma transacción,
todo lo que hace falta para crear o actualizar la suscripción y, si el dinero
ya salió, el cobro. Este módulo es lo que los DOS lados tienen que decir
igual: el exchange, la routing key, las colas y la forma del sobre.

── Por qué vive en `shared/` y no en cada servicio ───────────────────────────
Ya pasó una vez en este repo: el consumidor enlazaba `suscripcion.creada`
mientras el publicador mandaba `suscripcion.creada.v2`, y en un exchange
`topic` ese enlace no calza. La publicación fallaba por no enrutable y nada
avisaba, porque cada lado comparaba contra su propia copia. Acá hay una sola.

── Exchange propio, como el de uso (ADR-009) ─────────────────────────────────
`suscripciones` es el exchange de los hechos de subscriptions y lo escuchan
analytics y notifications. Si connectors publicara ahí, cualquier enlace con
comodín de esos servicios recibiría órdenes de cobro que no son suyas. Un
exchange por productor deja claro quién habla y quién escucha.

── La cola la declaran los dos lados ─────────────────────────────────────────
El publicador corre en el worker de connectors y el consumidor en el pod de
subscriptions; nadie garantiza cuál arranca primero. Con `mandatory=True`, un
mensaje sin cola enlazada vuelve como `UnroutableError` y el outbox reintenta.
Declarar la cola desde el publicador hace que ya esté esperando aunque el
consumidor no haya arrancado, y como es `durable` el mensaje queda guardado.
Declarar es idempotente.
"""

from __future__ import annotations

from decimal import Decimal

from . import _validacion

EVENTO = "candidato.confirmado"
VERSION = 1

#: El importe más grande que una orden puede llevar. Es el rango de
#: `Cobro.monto` y `Subscription.monto` en subscriptions, NUMERIC(10,2): un
#: importe mayor pasaría el contrato y reventaría al insertar, y la orden
#: terminaría en la cola de fallos sin crear nada. connectors lo rechaza al
#: confirmar (`confirmacion.IMPORTE_FUERA_DE_RANGO`) y el esquema JSON dice lo
#: mismo con su `pattern` (8 enteros y 2 decimales). Cambiarlo es cambiar las
#: columnas y el esquema a la vez; una prueba de cada lado lo amarra.
IMPORTE_MAXIMO = Decimal("99999999.99")

EXCHANGE = "connectors.eventos"
ROUTING_KEY = f"{EVENTO}.v{VERSION}"
COLA = "subscriptions.candidatos"

#: Lo que el consumidor rechaza (`requeue=False`) no se borra: se va acá.
#: `fanout` porque no hay nada que enrutar, todo lo que llega es un fallo.
EXCHANGE_FALLIDOS = "connectors.eventos.fallidos"
COLA_FALLIDOS = "subscriptions.candidatos.fallidos"

ORIGENES = ("csv", "correo")


def declarar(canal) -> None:
    """Deja exchange, cola, enlace y cola de fallos listos. Idempotente.

    Ojo: cambiar los argumentos de una cola que ya existe hace fallar la
    declaración con PRECONDITION_FAILED. Si hay que cambiarlos, la cola se
    borra y se vuelve a crear con el consumidor detenido.
    """
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    canal.exchange_declare(exchange=EXCHANGE_FALLIDOS, exchange_type="fanout", durable=True)
    canal.queue_declare(queue=COLA_FALLIDOS, durable=True)
    canal.queue_bind(exchange=EXCHANGE_FALLIDOS, queue=COLA_FALLIDOS)
    canal.queue_declare(
        queue=COLA,
        durable=True,
        arguments={"x-dead-letter-exchange": EXCHANGE_FALLIDOS},
    )
    # La versión EXACTA, sin comodín: una v2 cambia el esquema por definición
    # y consumirla con el código de v1 sería peor que no recibirla.
    canal.queue_bind(exchange=EXCHANGE, queue=COLA, routing_key=ROUTING_KEY)


_ESQUEMA = "candidato-confirmado-v1.schema.json"


def esquema() -> dict:
    return _validacion.esquema(_ESQUEMA)


def errores(sobre) -> list[str]:
    """Los incumplimientos del contrato, todos y en texto. Vacío si cumple."""
    return _validacion.errores(_ESQUEMA, sobre)

"""Exchange, cola, enlace y cola de fallos. Lo declaran los DOS lados.

── Por qué el publicador también declara la cola ────────────────────────────
Un exchange `topic` no guarda nada: toma el mensaje, busca las colas enlazadas
que calcen con la routing key y se lo entrega a cada una. Si en ese momento no
hay ninguna enlazada, con `mandatory=True` la publicación falla como
`UnroutableError` y el outbox la reintenta hasta los 900 s.

Eso significa que si el publicador arranca antes que el consumidor —cosa que
pasa siempre que se despliega, porque son contenedores distintos y nadie
garantiza el orden— los primeros eventos se quedan dando vueltas.

Declarar es idempotente: declarar algo que ya existe con los mismos
parámetros no hace nada. Así que el publicador declara la topología completa
al conectarse, y la cola ya está esperando aunque el consumidor todavía no
haya arrancado. Como la cola es `durable`, los mensajes quedan guardados
hasta que alguien los venga a buscar.

── La routing key sale del publicador, no de acá ────────────────────────────
`PATRONES_RESUMEN` se arma con `publicador.routing_key`, no con un literal.
La versión literal estuvo mal: decía `suscripcion.creada` mientras el
publicador mandaba a `suscripcion.creada.v2`, y en un topic ese enlace exacto
no coincide con esa clave. Nada avisaba, porque la prueba comparaba esta
constante contra este mismo archivo.

Se enlaza la versión EXACTA (v2) y no `suscripcion.creada.*` a propósito: una
v3 es, por definición del catálogo, un cambio que rompe el esquema. Consumirla
en silencio con el código de v2 sería peor que no recibirla. Cuando salga una
v3 hay que venir acá y decidir.

── La cola de fallos ────────────────────────────────────────────────────────
La cola principal tiene `x-dead-letter-exchange`: un mensaje rechazado con
`requeue=False` no se pierde, se va a `subscriptions.resumen.fallidos` y queda
ahí para mirarlo. Antes se descartaba, y bastaba una desconexión pasajera de
Postgres para perder un evento que el outbox ya había dado por publicado.
"""

from dataclasses import dataclass

from events.contrato import EXCHANGE, routing_key
COLA_RESUMEN = "subscriptions.resumen"

# A dónde van los mensajes que el consumidor rechaza. Exchange aparte y de
# tipo `fanout` porque acá no hay nada que enrutar: todo lo que llega es un
# fallo y va a la única cola de fallos.
EXCHANGE_FALLIDOS = "suscripciones.fallidos"
COLA_FALLIDOS = "subscriptions.resumen.fallidos"


@dataclass(frozen=True)
class _EventoParaClave:
    """Lo mínimo que `publicador.routing_key` necesita para armar la clave.

    Existe para poder preguntarle al publicador cuál es la clave de un evento
    sin tener que crear una fila de outbox. Así el enlace de la cola se arma
    con la MISMA función que publica, y no con una copia escrita a mano.
    """

    evento: str
    version: int


#: El resumen depende de creaciones, cambios de monto/moneda y transiciones
#: de estado. Los tres hechos v2 deben tener una ruta DURABLE, incluso si el
#: consumidor todavía no ha arrancado. Los nombres no llevan comodines: v3
#: requiere una decisión de contrato explícita.
EVENTOS_DEL_RESUMEN = (
    ("suscripcion.creada", 2),
    ("suscripcion.actualizada", 2),
    ("suscripcion.estado_cambiado", 2),
)

#: Las routing keys efectivas, derivadas del publicador. No tocar a mano.
PATRONES_RESUMEN = tuple(
    routing_key(_EventoParaClave(evento=nombre, version=version))
    for nombre, version in EVENTOS_DEL_RESUMEN
)


def declarar(canal) -> None:
    """Deja el exchange, las dos colas y los enlaces listos. Idempotente."""
    # durable=True en todo: sobreviven a un reinicio del broker, así que un
    # evento publicado mientras el consumidor estaba caído sigue ahí.
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)

    canal.exchange_declare(
        exchange=EXCHANGE_FALLIDOS, exchange_type="fanout", durable=True
    )
    canal.queue_declare(queue=COLA_FALLIDOS, durable=True)
    canal.queue_bind(exchange=EXCHANGE_FALLIDOS, queue=COLA_FALLIDOS)

    canal.queue_declare(
        queue=COLA_RESUMEN,
        durable=True,
        arguments={
            # Un reject/nack con requeue=False manda el mensaje acá en vez de
            # borrarlo. Ojo: cambiar estos argumentos en una cola que ya existe
            # hace fallar la declaración (PRECONDITION_FAILED); si hay que
            # cambiarlos, la cola se borra y se vuelve a crear en una ventana
            # con el consumidor detenido.
            "x-dead-letter-exchange": EXCHANGE_FALLIDOS,
        },
    )
    for patron in PATRONES_RESUMEN:
        canal.queue_bind(exchange=EXCHANGE, queue=COLA_RESUMEN, routing_key=patron)

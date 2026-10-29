"""Las colas de Notifications, sus enlaces y la cola de fallos (FE-24).

MX-21 fija los nombres y la separación:

    notifications.dominio.v2    las tres rutas de suscripción. Alimenta la
                                proyección (FE-17/FE-18) y la anulación de
                                alertas vencidas (FE-23).
    notifications.entregas.v2   `alerta.activada.v2`, que publica este mismo
                                servicio. Aparte del generador A PROPÓSITO,
                                para que una entrega no realimente al
                                generador y se arme un lazo.

── Las dos colas son independientes ────────────────────────────────────────
Durables y con su propio enlace. Que `alerta.activada` llegue a `entregas` y
NO a `dominio` es lo que corta la realimentación, y se consigue enlazando por
la routing key exacta: `dominio` solo pide las tres de suscripción.

── La routing key sale del contrato, no de un literal ──────────────────────
Igual que en Subscriptions, los patrones se derivan de
`shared.events.contrato.routing_key`. Escribirlos a mano es como se rompió
una vez: la cola enlazada a `suscripcion.creada` nunca recibió
`suscripcion.creada.v2`, y en un topic eso no da error, simplemente no
entrega. Entre dos servicios el síntoma es todavía más callado.

Se enlaza la versión EXACTA (v2) y no `suscripcion.creada.*`: una v3 rompe el
esquema por definición del catálogo, y consumirla con el código de v2 sería
peor que no recibirla.

── La cola de fallos ──────────────────────────────────────────────────────
Las dos colas llevan `x-dead-letter-exchange`, así que un mensaje rechazado
con `requeue=False` —un sobre que no cumple el contrato, un evento que no es
de esta cola, o un fallo que no mejora reintentando— se va a
`notifications.fallidos` y queda ahí para mirarlo. Nunca se descarta: eso es
lo que pide MX-21 y es lo que permite el replay después de corregir la causa.

OJO al cambiar los `arguments` de una cola que ya existe: la declaración
falla con PRECONDITION_FAILED. Hay que borrarla y recrearla en una ventana
con el consumidor detenido.
"""

from dataclasses import dataclass

from shared.events.contrato import EXCHANGE, routing_key


#: La cola de los eventos de dominio. El nombre también identifica al
#: consumidor en el inbox (`EventoRecibido.consumidor`), así que las dos
#: colas no se pisan la deduplicación.
COLA_DOMINIO = "notifications.dominio.v2"

#: La cola de entregas. La consume el worker de entrega (FE-22), no el
#: generador.
COLA_ENTREGAS = "notifications.entregas.v2"

#: A dónde va lo que se rechaza. Exchange `fanout` porque acá no hay nada que
#: enrutar: todo lo que llega es un fallo y va a la única cola de fallos.
EXCHANGE_FALLIDOS = "suscripciones.fallidos"
COLA_FALLIDOS = "notifications.fallidos"


@dataclass(frozen=True)
class _EventoParaClave:
    """Lo mínimo que `routing_key` necesita para armar la clave.

    Existe para poder preguntarle al contrato cuál es la clave de un evento
    sin tener que crear una fila de outbox. Así el enlace se arma con la MISMA
    función que publica, y no con una copia escrita a mano.
    """

    evento: str
    version: int


#: Los eventos de la cola de dominio, como (nombre, versión). Agregar uno acá
#: es la única forma de que esta cola lo reciba.
EVENTOS_DE_DOMINIO = (
    ("suscripcion.creada", 2),
    ("suscripcion.actualizada", 2),
    ("suscripcion.estado_cambiado", 2),
)

#: Los de la cola de entregas.
EVENTOS_DE_ENTREGA = (("alerta.activada", 2),)


def _patrones(eventos) -> tuple[str, ...]:
    return tuple(
        routing_key(_EventoParaClave(evento=nombre, version=version))
        for nombre, version in eventos
    )


#: Las routing keys efectivas, derivadas del contrato. No tocar a mano.
PATRONES_DOMINIO = _patrones(EVENTOS_DE_DOMINIO)
PATRONES_ENTREGAS = _patrones(EVENTOS_DE_ENTREGA)


def declarar(canal) -> None:
    """Deja el exchange, las tres colas y los enlaces listos. Idempotente.

    Lo llaman los dos lados —el publicador al conectarse y el consumidor al
    arrancar— porque un exchange topic no guarda nada: si al publicar no hay
    ninguna cola enlazada que calce, con `mandatory=True` la publicación falla
    como `UnroutableError`. Y el orden de arranque de dos contenedores no lo
    garantiza nadie.
    """
    # durable=True en todo: sobreviven a un reinicio del broker, así que un
    # evento publicado mientras el consumidor estaba caído sigue ahí.
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    canal.exchange_declare(
        exchange=EXCHANGE_FALLIDOS, exchange_type="fanout", durable=True
    )
    canal.queue_declare(queue=COLA_FALLIDOS, durable=True)
    canal.queue_bind(exchange=EXCHANGE_FALLIDOS, queue=COLA_FALLIDOS)

    for cola, patrones in (
        (COLA_DOMINIO, PATRONES_DOMINIO),
        (COLA_ENTREGAS, PATRONES_ENTREGAS),
    ):
        canal.queue_declare(
            queue=cola,
            durable=True,
            arguments={"x-dead-letter-exchange": EXCHANGE_FALLIDOS},
        )
        for patron in patrones:
            canal.queue_bind(exchange=EXCHANGE, queue=cola, routing_key=patron)

"""Exchange, cola y enlace. Lo declaran los DOS lados, a propósito.

── Por qué el publicador también declara la cola ────────────────────────────
Un exchange `topic` no guarda nada: toma el mensaje, busca las colas enlazadas
que calcen con la routing key y se lo entrega a cada una. Si en ese momento no
hay ninguna enlazada, el mensaje **se descarta en silencio**. No hay error, no
hay reintento, no queda rastro.

Eso significa que si el publicador arranca antes que el consumidor —cosa que
pasa siempre que se despliega, porque son contenedores distintos y nadie
garantiza el orden— los primeros eventos se pierden.

Declarar es idempotente: declarar algo que ya existe con los mismos
parámetros no hace nada. Así que el publicador declara la topología completa
al conectarse, y la cola ya está esperando aunque el consumidor todavía no
haya arrancado. Como la cola es `durable`, los mensajes quedan guardados
hasta que alguien los venga a buscar.

(Esto se encontró probando contra un RabbitMQ de verdad: con mocks el mensaje
"se publicaba" igual y la prueba pasaba.)
"""

EXCHANGE = "suscripciones"
COLA_RESUMEN = "subscriptions.resumen"

# Qué routing keys lleva la cola del resumen. Son patrones: el exchange es
# topic. Los demás eventos del catálogo se agregan acá cuando se usen.
PATRONES_RESUMEN = ("suscripcion.creada",)


def declarar(canal) -> None:
    """Deja el exchange, la cola y el enlace listos. Idempotente."""
    # durable=True en los dos: sobreviven a un reinicio del broker, así que
    # un evento publicado mientras el consumidor estaba caído sigue ahí.
    canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    canal.queue_declare(queue=COLA_RESUMEN, durable=True)
    for patron in PATRONES_RESUMEN:
        canal.queue_bind(exchange=EXCHANGE, queue=COLA_RESUMEN, routing_key=patron)

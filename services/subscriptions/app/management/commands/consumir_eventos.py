"""Consume los eventos de dominio desde RabbitMQ y hace el trabajo derivado.

    python manage.py consumir_eventos

Corre como un proceso aparte, al lado del worker de Celery. No atiende
tráfico HTTP: se queda escuchando la cola y procesando lo que llega.

── Idempotencia ─────────────────────────────────────────────────────────────
El catálogo (regla 1) exige que los consumidores lo sean, porque RabbitMQ
garantiza *al menos una* entrega. Acá sale gratis: `recalcular_resumen` lee el
estado actual de la base y hace `update_or_create`. Procesar el mismo evento
dos veces deja exactamente el mismo resultado, así que no hace falta guardar
los ids ya vistos.

── Por qué prefetch_count=1 ─────────────────────────────────────────────────
Sin eso RabbitMQ le manda al consumidor todos los mensajes de una, y se
pierde la razón de tener cola: que el trabajo se drene a ritmo parejo. Con 1,
no recibe el siguiente hasta confirmar el anterior.
"""

import json
import signal

import pika
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections

from events.publicador import EXCHANGE
from events.trabajo import recalcular_resumen

COLA = "subscriptions.resumen"

# Qué eventos nos interesan. El exchange es topic, así que esto son patrones
# de routing key. Hoy solo uno; los demás del catálogo se agregan acá.
PATRONES = ("suscripcion.creada",)


class Command(BaseCommand):
    help = "Escucha los eventos de dominio en RabbitMQ y recalcula el resumen."

    def add_arguments(self, parser):
        parser.add_argument(
            "--uno",
            action="store_true",
            help="Procesa un solo mensaje y termina. Para probar sin colgarse.",
        )

    def handle(self, *args, **opciones):
        conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
        canal = conexion.channel()
        canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
        # durable: la cola sobrevive al reinicio del broker, así que los
        # eventos publicados mientras el consumidor estaba caído siguen ahí.
        canal.queue_declare(queue=COLA, durable=True)
        for patron in PATRONES:
            canal.queue_bind(exchange=EXCHANGE, queue=COLA, routing_key=patron)
        canal.basic_qos(prefetch_count=1)

        def apagar(*_):
            self.stdout.write("apagando el consumidor")
            canal.stop_consuming()

        signal.signal(signal.SIGTERM, apagar)
        signal.signal(signal.SIGINT, apagar)

        def al_recibir(canal_, metodo, _propiedades, cuerpo):
            # Django cierra las conexiones a la base por petición HTTP; acá no
            # hay peticiones, así que hay que limpiarlas a mano o se quedan
            # conexiones muertas después de un corte.
            close_old_connections()
            try:
                sobre = json.loads(cuerpo)
                organizacion_id = sobre["organizacion_id"]
            except (ValueError, KeyError):
                # Un mensaje que no podemos ni leer no mejora con reintentos:
                # se descarta para que no bloquee la cola.
                self.stderr.write(f"evento ilegible, se descarta: {cuerpo[:200]!r}")
                canal_.basic_ack(delivery_tag=metodo.delivery_tag)
                return

            try:
                recalcular_resumen(organizacion_id)
            except Exception as error:
                # requeue=False: si falla por un dato malo, reencolarlo lo
                # haría fallar para siempre y taparía la cola.
                self.stderr.write(f"falló {sobre.get('evento')}: {error}")
                canal_.basic_nack(delivery_tag=metodo.delivery_tag, requeue=False)
                return

            canal_.basic_ack(delivery_tag=metodo.delivery_tag)
            if opciones["uno"]:
                canal_.stop_consuming()

        canal.basic_consume(queue=COLA, on_message_callback=al_recibir)
        self.stdout.write(f"escuchando {COLA} en {EXCHANGE}")
        canal.start_consuming()
        conexion.close()

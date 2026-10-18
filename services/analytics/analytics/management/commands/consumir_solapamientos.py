import logging

import pika
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from analytics.event_consumer import procesar_mensaje

EXCHANGE = "suscripciones"
EXCHANGE_INVALIDOS = "suscripciones.dlx"
COLA_ENTRADA = "analytics.solapamientos.v2"
COLA_INVALIDOS = "analytics.solapamientos.invalidos"
COLA_SALIDA = "analytics.recomendaciones.emitidas"

log = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Consume solapamientos v2 y publica recomendaciones de consolidación."

    def handle(self, *args, **options):
        url = getattr(settings, "RABBITMQ_URL", "")
        if not url:
            raise CommandError("RABBITMQ_URL debe estar configurada.")

        parametros = pika.URLParameters(url)
        with pika.BlockingConnection(parametros) as conexion:
            canal = conexion.channel()
            canal.exchange_declare(
                exchange=EXCHANGE,
                exchange_type="topic",
                durable=True,
            )
            canal.exchange_declare(
                exchange=EXCHANGE_INVALIDOS,
                exchange_type="topic",
                durable=True,
            )
            canal.queue_declare(
                queue=COLA_INVALIDOS,
                durable=True,
            )
            canal.queue_bind(
                queue=COLA_INVALIDOS,
                exchange=EXCHANGE_INVALIDOS,
                routing_key="analytics.solapamiento.invalido",
            )
            canal.queue_declare(
                queue=COLA_ENTRADA,
                durable=True,
                arguments={
                    "x-dead-letter-exchange": EXCHANGE_INVALIDOS,
                    "x-dead-letter-routing-key": "analytics.solapamiento.invalido",
                },
            )
            canal.queue_bind(
                queue=COLA_ENTRADA,
                exchange=EXCHANGE,
                routing_key="solapamiento.detectado.v2",
            )
            canal.queue_declare(queue=COLA_SALIDA, durable=True)
            canal.queue_bind(
                queue=COLA_SALIDA,
                exchange=EXCHANGE,
                routing_key="recomendacion.consolidacion_generada.v1",
            )
            canal.confirm_delivery()
            canal.basic_qos(prefetch_count=1)

            def consumir(ch, method, properties, body):
                procesar_mensaje(ch, method.delivery_tag, body)

            canal.basic_consume(
                queue=COLA_ENTRADA,
                on_message_callback=consumir,
            )
            log.info("Consumidor de solapamientos iniciado")
            self.stdout.write("Consumiendo solapamientos v2 de RabbitMQ.")
            try:
                canal.start_consuming()
            except KeyboardInterrupt:
                canal.stop_consuming()

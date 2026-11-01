"""Healthcheck real del consumidor pika (analytics-worker).

Un contenedor vivo no significa que el consumidor siga suscripto: si el
proceso se cayó o perdió la conexión, el contenedor seguiría "running". Esta
comprobación se conecta a RabbitMQ y exige que la cola tenga al menos un
consumidor registrado. Si RabbitMQ no responde, tampoco declara sano.
"""

import pika
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

# La misma cola que declara `consumir_solapamientos`.
COLA_ENTRADA = "analytics.solapamientos.v2"


class Command(BaseCommand):
    help = "Verifica que el consumidor de analytics siga suscripto a su cola."

    def handle(self, *args, **options):
        url = getattr(settings, "RABBITMQ_URL", "")
        if not url:
            raise CommandError("RABBITMQ_URL debe estar configurada.")

        try:
            with pika.BlockingConnection(pika.URLParameters(url)) as conexion:
                canal = conexion.channel()
                # Pika devuelve pika.frame.Method (no una tupla de tres
                # valores). El contador de consumidores vive en `.method`.
                resultado = canal.queue_declare(
                    queue=COLA_ENTRADA, passive=True
                )
                consumidores = resultado.method.consumer_count
        except Exception as exc:  # pika levanta varios tipos según el fallo
            raise CommandError(f"RabbitMQ no responde: {exc}") from exc

        if consumidores < 1:
            raise CommandError(
                f"La cola {COLA_ENTRADA} no tiene consumidores activos."
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"OK: {consumidores} consumidor(es) en {COLA_ENTRADA}."
            )
        )

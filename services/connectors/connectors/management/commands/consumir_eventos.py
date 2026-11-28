"""Escucha el acuse `candidato.aplicado` de Suscripciones.

    python manage.py consumir_eventos [--uno]

Corre como proceso aparte. El exchange es el mismo `suscripciones` de siempre;
la cola `connectors.aplicaciones` y su DLQ son propias de este flujo, así que
un mensaje malo no se mezcla con los fallos del outbox de ida. Con `--uno`
se detiene tras el primer mensaje, sea cual sea el desenlace.
"""

import signal

import pika
from django.conf import settings
from django.core.management.base import BaseCommand

from events import consumidor
from events.contrato import (
    COLA_APLICACIONES,
    COLA_FALLIDOS_APLICACIONES,
    EVENTO_APLICADO,
    EXCHANGE,
    VERSION_APLICADO,
)
from events.db import close_old_connections
from events.topologia import declarar_aplicaciones


class Command(BaseCommand):
    help = "Marca los candidatos aplicados por Suscripciones."

    def add_arguments(self, parser):
        parser.add_argument(
            "--uno",
            action="store_true",
            help="Procesa un solo mensaje y termina. Para probar sin colgarse.",
        )

    def handle(self, *args, **opciones):
        conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
        canal = conexion.channel()
        declarar_aplicaciones(canal)
        canal.basic_qos(prefetch_count=1)

        def apagar(*_):
            self.stdout.write("apagando el consumidor")
            canal.stop_consuming()

        signal.signal(signal.SIGTERM, apagar)
        signal.signal(signal.SIGINT, apagar)

        def al_recibir(canal_, metodo, _propiedades, cuerpo):
            self.atender(canal_, metodo, cuerpo)
            if opciones["uno"]:
                canal_.stop_consuming()

        canal.basic_consume(queue=COLA_APLICACIONES, on_message_callback=al_recibir)
        self.stdout.write(
            f"escuchando {COLA_APLICACIONES} en {EXCHANGE} "
            f"({EVENTO_APLICADO}.v{VERSION_APLICADO}); "
            f"los fallos van a {COLA_FALLIDOS_APLICACIONES}"
        )
        canal.start_consuming()
        conexion.close()

    def atender(self, canal_, metodo, cuerpo):
        """El ack va DESPUÉS de escribir; si falla, el broker reentrega."""
        close_old_connections()
        resultado = consumidor.procesar_aplicacion(cuerpo, avisar=self.stderr.write)

        if resultado.confirmar:
            canal_.basic_ack(delivery_tag=metodo.delivery_tag)
        else:
            self.stderr.write(
                f"a {COLA_FALLIDOS_APLICACIONES}: {resultado.motivo} | {cuerpo[:200]!r}"
            )
            canal_.basic_reject(delivery_tag=metodo.delivery_tag, requeue=False)
        return resultado

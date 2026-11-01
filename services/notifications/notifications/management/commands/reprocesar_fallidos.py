"""Replay acotado de la DLQ, conservando ID y ACK solo después del confirm."""
import copy

import pika
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from events.topologia import COLA_DOMINIO, COLA_FALLIDOS


def reenviar(canal, limite):
    # No crear colas ni bindings: solo se recupera dentro de una tanda activa.
    canal.queue_declare(queue=COLA_DOMINIO, passive=True)
    cantidad = canal.queue_declare(queue=COLA_FALLIDOS, passive=True).method.message_count
    canal.confirm_delivery()
    reenviados = 0
    # Los inválidos pueden volver inmediatamente a la DLQ; no hacer un bucle
    # infinito ni consumir más mensajes que los disponibles al iniciar.
    for _ in range(min(limite, cantidad)):
        metodo, propiedades, cuerpo = canal.basic_get(queue=COLA_FALLIDOS, auto_ack=False)
        if metodo is None:
            break
        propiedades = copy.copy(propiedades)
        propiedades.delivery_mode = 2
        try:
            canal.basic_publish(exchange='', routing_key=COLA_DOMINIO, body=cuerpo,
                                properties=propiedades, mandatory=True)
        except Exception:
            # Si se corta la conexión, el cierre también devuelve el unacked.
            if canal.is_open:
                canal.basic_nack(delivery_tag=metodo.delivery_tag, requeue=True)
            raise
        canal.basic_ack(delivery_tag=metodo.delivery_tag)
        reenviados += 1
    return reenviados


class Command(BaseCommand):
    help = 'Reenvía fallidos tras corregir la causa, sin borrar ni cambiar IDs.'

    def add_arguments(self, parser):
        parser.add_argument('--limite', type=int, default=100)

    def handle(self, *args, **opciones):
        if opciones['limite'] <= 0:
            raise CommandError('--limite debe ser positivo')
        if not settings.RABBITMQ_URL:
            raise CommandError('Falta configurar RABBITMQ_URL desde el Secret del broker')
        conexion = None
        try:
            parametros = pika.URLParameters(settings.RABBITMQ_URL)
            parametros.blocked_connection_timeout = 30
            conexion = pika.BlockingConnection(parametros)
            cantidad = reenviar(conexion.channel(), opciones['limite'])
        except (pika.exceptions.AMQPError, OSError):
            # No incluir excepciones del cliente: pueden contener la URL.
            raise CommandError('Replay interrumpido; comprobar broker y conservar la DLQ') from None
        finally:
            if conexion is not None and conexion.is_open:
                conexion.close()
        self.stdout.write(f'Reenviados: {cantidad}. Verificar efecto e inbox; no equivale a procesados.')

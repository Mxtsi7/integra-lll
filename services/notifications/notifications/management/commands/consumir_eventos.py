"""Consume snapshots v2. ACK solo después del commit; rechazo hacia DLQ propia."""
import signal
import time
import uuid

import pika
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError

from events.topologia import COLA_DOMINIO, declarar
from notifications.consumo import recibir


def identificador_seguro(valor):
    try:
        return str(uuid.UUID(str(valor)))
    except (ValueError, TypeError, AttributeError):
        return 'ausente_o_invalido'


class Command(BaseCommand):
    help = 'Mantiene SuscripcionVigilada desde RabbitMQ (FE-24).'

    def add_arguments(self, parser):
        parser.add_argument('--uno', action='store_true', help='Termina tras atender un mensaje.')

    def atender(self, canal, metodo, cuerpo, propiedades=None):
        ids = (f'message_id={identificador_seguro(getattr(propiedades, "message_id", None))} '
               f'correlation_id={identificador_seguro(getattr(propiedades, "correlation_id", None))}')
        for intento in range(3):
            close_old_connections()
            try:
                recibir(cuerpo)
            except (OperationalError, InterfaceError):
                if intento < 2:
                    time.sleep(2 ** intento)
                    continue
                self.stderr.write(f'Base no disponible: mensaje a notifications.fallidos {ids}')
            except Exception as error:
                # No imprimir cuerpo ni URLs con credenciales en logs de mensajes.
                regla = getattr(error, 'regla', 'no_aplica')
                ruta = getattr(error, 'ruta', 'no_aplica')
                self.stderr.write(f'Mensaje a notifications.fallidos: {type(error).__name__} '
                                  f'{ids} regla={regla} esquema={ruta}')
            else:
                canal.basic_ack(delivery_tag=metodo.delivery_tag)
                return
            canal.basic_reject(delivery_tag=metodo.delivery_tag, requeue=False)
            return

    def handle(self, *args, **opciones):
        if not settings.RABBITMQ_URL:
            raise CommandError('Falta configurar RABBITMQ_URL desde el Secret del broker')
        conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
        try:
            canal = conexion.channel()
            declarar(canal)
            canal.basic_qos(prefetch_count=1)
            anteriores = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
            def apagar(*_):
                conexion.add_callback_threadsafe(canal.stop_consuming)
            def atender(canal_, metodo, _propiedades, cuerpo):
                self.atender(canal_, metodo, cuerpo, _propiedades)
                if opciones['uno']:
                    canal_.stop_consuming()
            try:
                for s in anteriores:
                    signal.signal(s, apagar)
                canal.basic_consume(queue=COLA_DOMINIO, on_message_callback=atender, auto_ack=False)
                self.stdout.write(f'Escuchando {COLA_DOMINIO}', ending='\n')
                self.stdout.flush()
                canal.start_consuming()
            finally:
                for s, anterior in anteriores.items():
                    signal.signal(s, anterior)
        finally:
            if conexion.is_open:
                conexion.close()

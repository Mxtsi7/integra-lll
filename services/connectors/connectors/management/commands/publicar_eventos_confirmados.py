"""Drena `connectors_event_outbox` hacia RabbitMQ.

    python manage.py publicar_eventos_confirmados

Lo llama también Celery beat. Separarlo en comando permite ejecutar una pasada
a mano y probar el despacho sin broker ni worker.
"""

from django.core.management.base import BaseCommand

from events.despacho import despachar_pendientes


class Command(BaseCommand):
    help = "Publica los eventos confirmados pendientes del outbox."

    def handle(self, *args, **opciones):
        resultado = despachar_pendientes()
        self.stdout.write(
            f"publicados={resultado['publicados']} "
            f"reintentados={resultado['reintentados']}"
        )

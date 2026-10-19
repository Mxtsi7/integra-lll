import time

from django.db import close_old_connections
from django.core.management.base import BaseCommand

from app.eliminacion import procesar_eliminacion
from app.models import EliminacionOrganizacion


class Command(BaseCommand):
    help = "Reintenta las limpiezas pendientes de RF-01.7 (idempotente)."

    def add_arguments(self, parser):
        parser.add_argument("--continuo", action="store_true", help="Reintentar cada 60 segundos.")

    def handle(self, *args, **options):
        while True:
            for pk in EliminacionOrganizacion.objects.filter(completado_en__isnull=True).values_list("pk", flat=True):
                completa = procesar_eliminacion(pk)
                self.stdout.write(f"{pk}: {'completada' if completa else 'pendiente'}")
            if not options["continuo"]:
                return
            close_old_connections()
            time.sleep(60)

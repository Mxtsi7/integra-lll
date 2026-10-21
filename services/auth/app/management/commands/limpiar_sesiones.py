"""Retira sesiones expiradas sin borrar sesiones vigentes ni datos de usuario."""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from app.models import Sesion


class Command(BaseCommand):
    help = "Elimina sesiones cuyo vencimiento supera los días de retención (7 por defecto)."

    def add_arguments(self, parser):
        parser.add_argument("--dias-retencion", type=int, default=7)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        dias = options["dias_retencion"]
        if dias < 0:
            raise CommandError("--dias-retencion debe ser mayor o igual a cero.")
        limite = timezone.now() - timedelta(days=dias)
        candidatas = Sesion.objects.filter(vence_en__lte=limite)
        if options["dry_run"]:
            self.stdout.write(f"Sesiones que se eliminarían: {candidatas.count()}")
            return
        cantidad, _ = candidatas.delete()
        self.stdout.write(f"Sesiones eliminadas: {cantidad}")

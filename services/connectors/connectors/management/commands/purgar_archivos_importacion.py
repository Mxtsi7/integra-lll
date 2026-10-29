"""Borra los archivos de importación vencidos (FE-07).

    python manage.py purgar_archivos_importacion            # en seco
    python manage.py purgar_archivos_importacion --aplicar

El archivo subido es almacenamiento TEMPORAL: lo necesita el procesamiento y
después sobra. Cada uno trae su `vence_en` (la subida lo fija con
`IMPORTACION_DIAS_RETENCION`); pasado eso se borra. La importación, sus
candidatos y sus errores no se tocan: lo que sobra es el archivo, no el
resultado.

En seco por omisión, como los demás comandos que borran algo.
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from connectors.models import ArchivoImportacion, Importacion


class Command(BaseCommand):
    help = "Borra los archivos de importación cuyo plazo de retención venció."

    def add_arguments(self, parser):
        parser.add_argument("--aplicar", action="store_true", help="Sin esto solo cuenta.")

    def handle(self, *args, **opciones):
        vencidos = ArchivoImportacion.objects.filter(vence_en__lt=timezone.now())
        cantidad = vencidos.count()
        if not opciones["aplicar"]:
            self.stdout.write(
                f"{cantidad} archivo(s) vencido(s). Modo ensayo: para borrarlos, --aplicar"
            )
            return
        # ── Las importaciones sin archivo quedan FALLIDAS ──────────────────
        # Borrar el archivo y dejar la importación en `pendiente` la vuelve
        # imposible de procesar: FE-09 la tomaría, buscaría el archivo y no
        # habría nada. Lo encontró la revisión de #120.
        #
        # Va en la MISMA transacción que el borrado: si falla una, no queda ni
        # la importación huérfana ni el archivo a medio borrar.
        importaciones = list(
            Importacion.objects.filter(
                archivo__in=vencidos,
                estado__in=(Importacion.Estado.PENDIENTE, Importacion.Estado.PROCESANDO),
            )
        )
        with transaction.atomic():
            for importacion in importaciones:
                importacion.anotar_error(
                    "archivo_vencido",
                    "El archivo se purgó por retención antes de procesarse.",
                )
                importacion.save(update_fields=["errores", "errores_totales"])
                importacion.avanzar_a(Importacion.Estado.FALLIDA)
            borrados, _ = vencidos.delete()

        self.stdout.write(
            f"Borrados {borrados} archivo(s) vencido(s). "
            f"{len(importaciones)} importacion(es) sin procesar quedaron FALLIDAS."
        )

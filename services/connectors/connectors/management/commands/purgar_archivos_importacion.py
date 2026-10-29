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
from django.utils import timezone

from connectors.models import ArchivoImportacion


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
        borrados, _ = vencidos.delete()
        self.stdout.write(f"Borrados {borrados} archivo(s) vencido(s); las importaciones quedan.")

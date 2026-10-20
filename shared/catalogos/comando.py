from importlib import import_module

from django.apps import apps
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction


class ComandoCatalogo(BaseCommand):
    help = "Crea, renombra o desactiva opciones globales. No cambia códigos ni elimina filas."
    modelos = {}
    migracion_inicial = ""

    def add_arguments(self, parser):
        parser.add_argument("catalogo", choices=self.modelos, nargs="?")
        parser.add_argument("codigo", nargs="?")
        parser.add_argument("--nombre")
        parser.add_argument("--orden", type=int)
        grupo = parser.add_mutually_exclusive_group()
        grupo.add_argument("--desactivar", action="store_true")
        grupo.add_argument("--activar", action="store_true")
        parser.add_argument("--cargar-iniciales", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["cargar_iniciales"]:
            if any(options[k] is not None for k in ("catalogo", "codigo", "nombre", "orden")) or options["activar"] or options["desactivar"]:
                raise CommandError("--cargar-iniciales se usa sin otras opciones.")
            with connection.schema_editor(atomic=False) as editor:
                import_module(self.migracion_inicial).cargar(apps, editor)
            self.stdout.write("Datos iniciales cargados; las opciones existentes se conservaron.")
            return
        if not options["catalogo"] or not options["codigo"]:
            raise CommandError("Indica catálogo y código.")
        modelo = self.modelos[options["catalogo"]]
        objeto = modelo.objects.select_for_update().filter(codigo=options["codigo"]).first()
        if objeto is None:
            if not options["nombre"] or options["desactivar"]:
                raise CommandError("Para crear una opción indica --nombre.")
            objeto = modelo(codigo=options["codigo"], nombre=options["nombre"])
        if options["nombre"] is not None:
            objeto.nombre = options["nombre"]
        if options["orden"] is not None:
            objeto.orden = options["orden"]
        if options["desactivar"]:
            objeto.activo = False
        elif options["activar"]:
            objeto.activo = True
        try:
            objeto.save()
        except ValidationError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(f"{objeto.codigo}: {objeto.nombre} (activo={objeto.activo})")

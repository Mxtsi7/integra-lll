"""Borra los archivos de importación vencidos (FE-07).

    python manage.py purgar_archivos_importacion            # en seco
    python manage.py purgar_archivos_importacion --aplicar

El archivo subido es almacenamiento TEMPORAL: lo necesita el procesamiento y
después sobra. Cada uno trae su `vence_en` (la subida lo fija con
`IMPORTACION_DIAS_RETENCION`); pasado eso se borra. La importación, sus
candidatos y sus errores no se tocan: lo que sobra es el archivo, no el
resultado.

En seco por omisión, como los demás comandos que borran algo.

── La decisión se toma sobre la fila VIGENTE, bloqueada ────────────────────
La versión anterior elegía las importaciones antes de abrir la transacción,
ignoraba lo que devolvía `avanzar_a` y borraba todos los archivos vencidos
igual. Si otro proceso reclamaba la importación entre la selección y la
transición (pendiente → procesando), el CAS de `avanzar_a` perdía, la
importación seguía en `procesando` y el archivo desaparecía: una importación
activa sin archivo. Lo reprodujo la revisión de #120.

Ahora cada archivo se trata en su propia transacción:

    1. se bloquea la importación (FOR UPDATE) y después el archivo;
    2. se vuelve a leer: si el archivo ya no está o ya no está vencido, no se
       hace nada (otra purga lo borró, o se renovó);
    3. si la importación ya es TERMINAL (completada o fallida), solo se borra
       el archivo: no se tocan su estado ni sus errores, que pueden venir de
       un procesamiento que terminó mientras esta purga preparaba la lista;
    4. si está pendiente o procesando, se anota el error y se pasa a
       `fallida`, y recién con esa transición persistida se borra el archivo.
       Si la transición no se pudiera hacer, se revierte todo y no se borra.

Con la fila bloqueada, quien quiera mover el estado al mismo tiempo (FE-09
marcando `completada`) espera, y al soltarse su CAS encuentra `fallida` y no
pisa nada. Dos purgas a la vez tampoco se pisan: la segunda espera y después
ya no encuentra el archivo.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from connectors.models import ArchivoImportacion, Importacion

FALLIDA = "fallida"          # estaba activa: quedó fallida y se borró el archivo
TERMINAL = "terminal"        # ya estaba terminada: solo se borró el archivo
YA_NO_ESTABA = "ya_no_estaba"  # otra purga lo borró, o se renovó el vencimiento
OMITIDA = "omitida"          # no se pudo hacer la transición: no se borró nada


def candidatos(ahora):
    """(archivo, importación) vencidos al empezar. Es solo una lista de trabajo:
    cada uno se vuelve a decidir con la fila bloqueada."""
    return list(
        ArchivoImportacion.objects.filter(vence_en__lt=ahora)
        .order_by("pk")
        .values_list("pk", "importacion_id")
    )


def purgar_uno(archivo_pk, importacion_pk, ahora) -> str:
    """Purga UN archivo vencido, decidiendo sobre el estado vigente."""
    with transaction.atomic():
        # Primero la importación y después el archivo: el mismo orden en que
        # los crea la subida, para que dos procesos no se bloqueen en cruz.
        importacion = (
            Importacion.objects.select_for_update().filter(pk=importacion_pk).first()
        )
        archivo = (
            ArchivoImportacion.objects.select_for_update()
            .filter(pk=archivo_pk, vence_en__lt=ahora)
            .first()
        )
        if archivo is None:
            return YA_NO_ESTABA

        if importacion is not None and not importacion.terminada:
            importacion.anotar_error(
                "archivo_vencido",
                "El archivo se purgó por retención antes de procesarse.",
            )
            importacion.save(update_fields=["errores", "errores_totales", "actualizado_en"])
            if not importacion.avanzar_a(Importacion.Estado.FALLIDA):
                # Con la fila bloqueada no debería pasar. Si pasa, no se borra
                # el archivo de una importación cuyo estado no se pudo fijar.
                transaction.set_rollback(True)
                return OMITIDA
            archivo.delete()
            return FALLIDA

        archivo.delete()
        return TERMINAL


class Command(BaseCommand):
    help = "Borra los archivos de importación cuyo plazo de retención venció."

    def add_arguments(self, parser):
        parser.add_argument("--aplicar", action="store_true", help="Sin esto solo cuenta.")

    def handle(self, *args, **opciones):
        ahora = timezone.now()
        lista = candidatos(ahora)
        if not opciones["aplicar"]:
            self.stdout.write(
                f"{len(lista)} archivo(s) vencido(s). Modo ensayo: para borrarlos, --aplicar"
            )
            return

        resultado = Counter(purgar_uno(a, i, ahora) for a, i in lista)
        borrados = resultado[FALLIDA] + resultado[TERMINAL]
        self.stdout.write(
            f"Borrados {borrados} archivo(s) vencido(s): "
            f"{resultado[FALLIDA]} importacion(es) sin procesar quedaron FALLIDAS, "
            f"{resultado[TERMINAL]} ya estaban terminadas. "
            f"{resultado[YA_NO_ESTABA]} ya no estaban, {resultado[OMITIDA]} se omitieron."
        )

"""Manda las entregas de alertas que toca mandar y anota qué pasó (S3-FE-21).

    python manage.py despachar_alertas                 # con el reloj real
    python manage.py despachar_alertas --limite 50
    python manage.py despachar_alertas --ahora 2026-11-21T23:00:00-03:00

Correrlo de más no duplica nada: cada entrega se reclama bajo bloqueo antes
de mandarse, y dos corridas a la vez se reparten las entregas en vez de
mandarlas dos veces (ver `notifications/entregas.py`). Está pensado para
correr después de `generar_alertas`, cada pocos minutos; dónde se programe
(CronJob o beat) es una decisión aparte y no cambia esto.

La salida dice cuántas quedaron en cada estado y lista las que no se
aceptaron con su código, sin la dirección ni el contenido. Las agotadas van
también a stderr: son las que ya no se van a reintentar solas.
"""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from notifications import entregas
from notifications.reloj import instante_de_opcion

#: El orden en que se informan los desenlaces.
DESENLACES = (
    (entregas.ACEPTADA, "aceptada(s) por el proveedor"),
    (entregas.DIFERIDA, "diferida(s)"),
    (entregas.REINTENTO, "en reintento"),
    (entregas.FALLIDA, "fallida(s)"),
    (entregas.AGOTADA, "agotada(s)"),
    (entregas.DESCARTADA, "descartada(s)"),
    (entregas.SIN_TOCAR, "tomada(s) por otra corrida"),
    (entregas.TARDIA, "con resultado tardío"),
)


class Command(BaseCommand):
    help = "Manda las alertas pendientes por correo y anota aceptación o error."

    def add_arguments(self, parser):
        parser.add_argument(
            "--ahora",
            default=None,
            help="Instante ISO con zona (p. ej. 2026-11-21T23:00:00-03:00). Por omisión, la hora real.",
        )
        parser.add_argument(
            "--limite",
            type=int,
            default=entregas.LIMITE_POR_CORRIDA,
            help=f"Cuántas entregas atender como máximo (por omisión {entregas.LIMITE_POR_CORRIDA}).",
        )

    def handle(self, *args, **opciones):
        if opciones["limite"] < 1:
            raise CommandError("--limite debe ser positivo")
        ahora = instante_de_opcion(opciones["ahora"]) if opciones["ahora"] else None

        resumen = entregas.despachar(ahora=ahora, limite=opciones["limite"])

        partes = [f"{resumen[clave]} {texto}" for clave, texto in DESENLACES if resumen[clave]]
        self.stdout.write(
            f"{timezone.localtime(ahora or timezone.now()):%Y-%m-%d %H:%M %Z}: "
            + (", ".join(partes) if partes else "nada que despachar")
            + "."
        )
        # Una consulta para todas, no una por línea.
        filas = {
            fila["pk"]: fila
            for fila in entregas.EntregaAlerta.objects.filter(
                pk__in=[entrega_id for entrega_id, _ in resumen.problemas]
            ).values("pk", "canal", "codigo_error", "intentos")
        }
        borrada = {"canal": "?", "codigo_error": "ya no existe", "intentos": 0}
        for entrega_id, desenlace in resumen.problemas:
            fila = filas.get(entrega_id, borrada)
            linea = (
                f"  · entrega {entrega_id} [{fila['canal']}] {desenlace}: "
                f"{fila['codigo_error'] or 'sin código'} (intento {fila['intentos']})"
            )
            self.stdout.write(linea)
            if desenlace == entregas.AGOTADA:
                self.stderr.write(linea)

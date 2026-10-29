"""Genera las alertas de próximos cobros y de fin de prueba (FE-17 / FE-18).

    python manage.py generar_alertas                      # con el reloj real
    python manage.py generar_alertas --ahora 2026-11-21T10:00:00-03:00

Es idempotente: correrlo varias veces el mismo día no duplica nada (ver
`generador.py`). Está pensado para correr una vez al día; dónde se programe
(CronJob de Kubernetes o beat) es una decisión aparte y no cambia esto.

`--ahora` existe para reproducir un día cualquiera: es el mismo reloj
controlable que usan las pruebas.
"""

import datetime as dt

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from notifications.generador import generar


class Command(BaseCommand):
    help = "Genera las alertas de próximos cobros y de fin de prueba."

    def add_arguments(self, parser):
        parser.add_argument(
            "--ahora",
            default=None,
            help="Instante ISO con zona (p. ej. 2026-11-21T10:00:00-03:00). Por omisión, ahora.",
        )

    def handle(self, *args, **opciones):
        ahora = timezone.now()
        if opciones["ahora"]:
            try:
                ahora = dt.datetime.fromisoformat(opciones["ahora"])
            except ValueError as exc:
                raise CommandError(f"--ahora no es un instante ISO: {exc}") from exc
            if ahora.tzinfo is None:
                ahora = timezone.make_aware(ahora, timezone.get_current_timezone())

        resultado = generar(ahora=ahora)
        self.stdout.write(
            f"{timezone.localtime(ahora):%Y-%m-%d %H:%M %Z}: "
            f"{len(resultado.creadas)} alerta(s) nueva(s), "
            f"{resultado.repetidas} ya existían, "
            f"{resultado.revisadas} suscripción(es) revisadas."
        )
        for alerta in resultado.creadas:
            self.stdout.write(f"  · [{alerta.get_tipo_display()}] {alerta.titulo}")

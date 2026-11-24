"""El reloj controlable de los comandos (`--ahora`).

`generar_alertas` y `despachar_alertas` aceptan el mismo `--ahora` para
reproducir un instante cualquiera; la lectura vive acá para que los dos lo
entiendan igual.
"""

import datetime as dt

from django.core.management.base import CommandError
from django.utils import timezone


def instante_de_opcion(texto: str | None) -> dt.datetime:
    """El instante de `--ahora`, o el reloj real si no vino.

    Sin zona se entiende en la del servicio (America/Santiago).
    """
    if not texto:
        return timezone.now()
    try:
        instante = dt.datetime.fromisoformat(texto)
    except ValueError as exc:
        raise CommandError(f"--ahora no es un instante ISO: {exc}") from exc
    if instante.tzinfo is None:
        instante = timezone.make_aware(instante, timezone.get_current_timezone())
    return instante

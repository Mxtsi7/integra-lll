"""Serialización de instantes del catálogo de eventos interna.

El contrato canónico ``uso-recolectores-v1`` y los consumidores TypeScript
aceptan entre 1 y 3 dígitos fraccionarios antes de la ``Z``. Python entrega 6
cuando el ``datetime`` trae microsegundos (``isoformat``), así que todo sobre
publicado recorta a milisegundos acá y no en cada publicador. Tener una sola
función evita que dos eventos del mismo catálogo salgan con precisiones
distintas.
"""

from __future__ import annotations

from datetime import timezone as datetime_timezone


def iso_utc_milisegundos(instante) -> str:
    """Devuelve ``AAAA-MM-DDTHH:MM:SS.sssZ`` en UTC, sin microsegundos.

    El sufijo ``Z`` es parte del contrato: reemplaza el ``+00:00`` que emite
    ``isoformat`` para ``timezone.utc``. ``timespec="milliseconds"`` trunca —no
    redondea— los dígitos sobrantes, así que un instante nunca se publica como
    un momento posterior al real.
    """
    return (
        instante.astimezone(datetime_timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

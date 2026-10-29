"""Recibir un evento: inbox + efecto, en UNA transacción (FE-24 / MX-21).

Esto es lo que hace que el consumidor sea idempotente de verdad. El contrato
pide tres cosas y las tres están acá:

    1. inbox con unicidad (consumidor, organizacion_id, id)
    2. el efecto en la MISMA transacción que la fila del inbox
    3. ack DESPUÉS del commit  ← lo hace el comando, no este módulo

── Por qué la unicidad y no un `exists()` ──────────────────────────────────
La forma tentadora es:

    if EventoRecibido.objects.filter(...).exists():
        return  # duplicado
    hacer_el_efecto()

Eso no deduplica nada. Con dos consumidores —o con uno que se reconectó
mientras el otro todavía trabajaba— los dos hacen el SELECT, los dos lo ven
vacío y los dos hacen el efecto. Es el mismo error que un `if` antes de un
`save()`: el guardia tiene que estar en la base.

Acá el guardia ES el INSERT. Se inserta la fila del inbox primero; si choca
con la restricción única, el mensaje ya se procesó y no se hace nada. No hay
ventana entre comprobar y actuar, porque comprobar y actuar son la misma
instrucción.

── Por qué el efecto va en la misma transacción ────────────────────────────
Si el inbox se guardara aparte, los dos órdenes posibles fallan:

    inbox primero, efecto después  → un corte entre los dos deja el evento
                                     marcado como procesado SIN efecto, y la
                                     reentrega no lo arregla: el inbox dice
                                     que ya está.
    efecto primero, inbox después  → un corte deja el efecto hecho sin
                                     marca, y la reentrega lo repite.

Con las dos cosas en una transacción no hay estado intermedio: o el evento
está procesado y el efecto está hecho, o no pasó nada y RabbitMQ lo vuelve a
entregar.

── El ack va afuera, y después ─────────────────────────────────────────────
Este módulo no toca el canal a propósito. Devuelve qué pasó y el comando hace
el ack, así que el ack siempre ocurre después del commit. Si el proceso muere
entre el commit y el ack, el mensaje vuelve y el inbox lo descarta sin
repetir el efecto: eso es la reentrega deduplicada que MX-21 pide demostrar.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_datetime

from notifications.models import EventoRecibido

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Recepcion:
    """Qué pasó con un mensaje."""

    #: True si este proceso hizo el efecto; False si el evento ya estaba en
    #: el inbox (reentrega) o si el efecto decidió que no había nada que hacer.
    efecto: bool
    #: True solo cuando se descartó por duplicado. Distinto de `efecto=False`
    #: por un evento viejo: el primero es una reentrega, el segundo es un
    #: mensaje nuevo que no cambió nada, y el log tiene que poder diferenciarlos.
    duplicado: bool = False

    def __bool__(self) -> bool:
        return self.efecto


def recibir(sobre: dict, *, consumidor: str, hacer) -> Recepcion:
    """Registra el evento y hace el efecto, o lo descarta por duplicado.

    `hacer` recibe el sobre y devuelve si cambió algo. Se llama DENTRO de la
    transacción, así que puede escribir con la garantía de que su escritura y
    la marca del inbox viven o mueren juntas. Si lanza, no queda nada: ni la
    marca ni el efecto, y el mensaje vuelve por la cola.

    Lanza lo que lance `hacer`: decidir si un fallo es pasajero o definitivo
    es del comando, que es el que tiene la cola de fallos y los reintentos.
    """
    evento_id = sobre["id"]
    recibido = EventoRecibido(
        organizacion_id=sobre["organizacion_id"],
        consumidor=consumidor,
        evento_id=evento_id,
        evento=str(sobre.get("evento", ""))[:60],
        ocurrido_en=parse_datetime(str(sobre["ocurrido_en"])),
    )

    with transaction.atomic():
        # ── El INSERT es el guardia ─────────────────────────────────────────
        # Va en su PROPIO savepoint, y no envuelto junto con el efecto, para
        # que el `except IntegrityError` capture solo el choque de unicidad
        # del inbox. Si abarcara las dos cosas, un IntegrityError del efecto
        # —una restricción cualquiera de otra tabla— se vería como "duplicado"
        # y el mensaje recibiría ACK con el efecto sin hacer.
        try:
            with transaction.atomic():
                recibido.save(force_insert=True)
        except IntegrityError:
            # ── La reentrega ────────────────────────────────────────────────
            # Choca con `evento_recibido_unico_por_consumidor`. El mensaje ya
            # se procesó: se confirma sin efecto adicional, que es lo que pide
            # el contrato.
            log.info(
                "evento %s ya estaba en el inbox de %s: se confirma sin repetir",
                evento_id, consumidor,
            )
            return Recepcion(efecto=False, duplicado=True)

        hubo_efecto = bool(hacer(sobre))
        if not hubo_efecto:
            # Se registra igual, con la bandera en False: el evento está
            # procesado (no hay que volver a verlo) pero no cambió nada. Lo
            # normal cuando llega un evento más viejo que la proyección.
            EventoRecibido.objects.filter(pk=recibido.pk).update(hubo_efecto=False)

    return Recepcion(efecto=hubo_efecto)


def ya_recibido(evento_id, organizacion_id, *, consumidor: str) -> bool:
    """Si el inbox ya tiene este evento. **Solo para pruebas y diagnóstico.**

    No usar para decidir si procesar: eso es el `exists()` que esta
    arquitectura evita a propósito. Está acá para que una prueba pueda
    comprobar que la fila quedó, y para mirar el inbox desde el admin.
    """
    return EventoRecibido.objects.filter(
        consumidor=consumidor,
        organizacion_id=uuid.UUID(str(organizacion_id)),
        evento_id=uuid.UUID(str(evento_id)),
    ).exists()

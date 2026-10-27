"""Despacho concurrente del outbox con reintentos y confirmación AMQP."""

import logging
from datetime import timedelta

import pika
from django.db import transaction
from django.utils import timezone

from app.models import OutboxEvento
from events.publicador import publicar


logger = logging.getLogger(__name__)
TAMANO_LOTE = 100
REINTENTO_MAXIMO_SEGUNDOS = 900


def despachar_pendientes() -> dict[str, int]:
    ids = list(
        OutboxEvento.objects.filter(
            publicado_en__isnull=True,
            siguiente_intento__lte=timezone.now(),
        )
        .order_by("creado_en", "id")
        .values_list("id", flat=True)[:TAMANO_LOTE]
    )
    publicados = 0
    reintentados = 0

    for evento_id in ids:
        with transaction.atomic():
            evento = (
                OutboxEvento.objects.select_for_update(skip_locked=True)
                .filter(
                    pk=evento_id,
                    publicado_en__isnull=True,
                    siguiente_intento__lte=timezone.now(),
                )
                .first()
            )
            if evento is None:
                continue

            try:
                publicar(evento)
            except (pika.exceptions.AMQPError, OSError) as exc:
                evento.intentos += 1
                espera = min(
                    5 * (2 ** min(evento.intentos - 1, 8)),
                    REINTENTO_MAXIMO_SEGUNDOS,
                )
                evento.siguiente_intento = timezone.now() + timedelta(seconds=espera)
                evento.ultimo_error = type(exc).__name__
                evento.save(
                    update_fields=("intentos", "siguiente_intento", "ultimo_error")
                )
                reintentados += 1
                logger.error(
                    "Falló publicación RabbitMQ: evento=%s id=%s error=%s reintento_s=%s",
                    evento.evento,
                    evento.id,
                    evento.ultimo_error,
                    espera,
                )
            else:
                evento.publicado_en = timezone.now()
                evento.ultimo_error = ""
                evento.save(update_fields=("publicado_en", "ultimo_error"))
                publicados += 1

    return {"publicados": publicados, "reintentados": reintentados}

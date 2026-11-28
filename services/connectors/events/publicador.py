"""Publicador del sobre `candidato.confirmado` v1 desde el outbox de connectors."""

import json
from datetime import timezone as datetime_timezone

import pika
from django.conf import settings

from events.contrato import EXCHANGE, routing_key
from events.topologia import declarar


def crear_payload(evento) -> dict:
    """Convierte una fila de `connectors_event_outbox` en la envoltura común."""
    return {
        "evento": evento.evento,
        "version": evento.version,
        "id": str(evento.id),
        "ocurrido_en": (
            evento.ocurrido_en.astimezone(datetime_timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        ),
        "correlation_id": str(evento.correlation_id),
        "organizacion_id": str(evento.organizacion_id),
        "datos": evento.datos,
    }


def publicar(evento) -> None:
    """Publica durable y confirmado; si no lanza, el broker aceptó el mensaje."""
    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        declarar(canal)
        canal.confirm_delivery()
        canal.basic_publish(
            exchange=EXCHANGE,
            routing_key=routing_key(evento),
            body=json.dumps(crear_payload(evento), separators=(",", ":")).encode(
                "utf-8"
            ),
            properties=pika.BasicProperties(
                delivery_mode=pika.DeliveryMode.Persistent,
                content_type="application/json",
                message_id=str(evento.id),
                correlation_id=str(evento.correlation_id),
                type=evento.evento,
                headers={"version": evento.version},
            ),
            mandatory=True,
        )
    finally:
        if conexion.is_open:
            conexion.close()

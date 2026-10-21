"""Publicador RabbitMQ para el contrato de eventos MX-21 v2."""

import json
from datetime import timezone as datetime_timezone

import pika
from django.conf import settings


EXCHANGE = "suscripciones"


def crear_payload(evento) -> dict:
    """Convierte un registro de outbox al sobre común de MX-21."""
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
    """Publica de forma durable y confirma el mensaje antes de completar."""
    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        canal.exchange_declare(
            exchange=EXCHANGE,
            exchange_type="topic",
            durable=True,
        )
        canal.confirm_delivery()
        confirmado = canal.basic_publish(
            exchange=EXCHANGE,
            routing_key=f"{evento.evento}.v{evento.version}",
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
        if not confirmado:
            raise pika.exceptions.AMQPError("RabbitMQ no confirmó la publicación.")
    finally:
        if conexion.is_open:
            conexion.close()

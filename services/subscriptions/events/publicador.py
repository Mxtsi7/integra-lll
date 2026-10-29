"""Publicador RabbitMQ para el contrato de eventos MX-21 v2."""

import json
from datetime import timezone as datetime_timezone

import pika
from django.conf import settings

from events.contrato import EXCHANGE, routing_key
from events.topologia import declarar


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
    """Publica de forma durable y confirma el mensaje antes de completar.

    NOTA pika 1.x: con confirm_delivery() activo, basic_publish devuelve None
    (no True/False). Un rechazo del broker lanza NackError o UnroutableError
    directamente, ambos subclases de AMQPError, que el llamador ya captura.
    No se debe chequear el valor de retorno: si no lanza, la publicación fue exitosa.
    """
    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        # Declara exchange + cola + enlace, no solo el exchange. Un exchange
        # topic sin cola enlazada descarta el mensaje; con mandatory=True eso
        # sale como UnroutableError y el outbox reintenta hasta los 900 s,
        # así que todo lo publicado antes de que arranque el consumidor se
        # queda dando vueltas. Declarando acá la cola ya existe y los
        # eventos esperan en ella. Es idempotente. Ver events/topologia.py.
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

"""Adaptador de mensajes RabbitMQ para recomendaciones de consolidación."""

import json
import logging

import pika

from analytics.jobs import procesar_evento_solapamiento

EXCHANGE = "suscripciones"
ROUTING_KEY_SALIDA = "recomendacion.consolidacion_generada.v1"

log = logging.getLogger(__name__)


def procesar_mensaje(
    channel,
    delivery_tag: int,
    body: bytes,
) -> None:
    try:
        evento = json.loads(body)
        salidas = procesar_evento_solapamiento(evento)
    except (ValueError, TypeError) as exc:
        log.warning("Se rechaza evento de solapamiento inválido: %s", exc)
        channel.basic_nack(delivery_tag=delivery_tag, requeue=False)
        return

    for salida in salidas:
        channel.basic_publish(
            exchange=EXCHANGE,
            routing_key=ROUTING_KEY_SALIDA,
            body=json.dumps(salida, ensure_ascii=False, separators=(",", ":")),
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=2,
                message_id=salida["id"],
                correlation_id=salida["correlation_id"],
            ),
            mandatory=True,
        )
    channel.basic_ack(delivery_tag=delivery_tag)

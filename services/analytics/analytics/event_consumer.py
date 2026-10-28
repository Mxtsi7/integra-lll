"""Adaptador de mensajes RabbitMQ para recomendaciones de consolidación."""

import json
import logging
from datetime import datetime
from decimal import Decimal

import pika
from django.db import transaction

from analytics.jobs import procesar_evento_solapamiento
from analytics.models import RecomendacionConsolidacion

EXCHANGE = "suscripciones"
ROUTING_KEY_SALIDA = "recomendacion.consolidacion_generada.v1"

log = logging.getLogger(__name__)


def _persistir_recomendaciones(salidas) -> None:
    """Persiste las salidas de VI-20 de forma idempotente.

    La clave es el ``id`` determinista del evento de salida. ``estado`` no se
    incluye en ``defaults`` a propósito: una reentrega no debe revivir una
    recomendación que VI-18 ya descartó.
    """
    with transaction.atomic():
        for salida in salidas:
            datos = salida["datos"]
            candidata = datos["suscripcion_candidata"]
            ahorro = datos["ahorro_potencial"]
            evidencia = datos["evidencia"]
            ocurrido_en = datetime.fromisoformat(
                salida["ocurrido_en"].replace("Z", "+00:00")
            )
            RecomendacionConsolidacion.objects.update_or_create(
                id=salida["id"],
                defaults={
                    "organizacion_id": salida["organizacion_id"],
                    "evento_origen_id": datos["evento_origen_id"],
                    "correlation_id": salida["correlation_id"],
                    "ocurrido_en": ocurrido_en,
                    "tipo": datos.get("tipo") or "consolidacion_categoria",
                    "categoria": datos["categoria"],
                    "suscripcion_id": candidata["id"],
                    "suscripcion_nombre": candidata["nombre"],
                    "suscripciones_relacionadas": datos.get(
                        "suscripciones_relacionadas", []
                    ),
                    "motivo": datos["motivo"],
                    "ahorro_estimado": Decimal(str(ahorro["monto_mensual"])),
                    "moneda": ahorro["moneda"],
                    "base_calculo": ahorro.get("base_calculo", ""),
                    "evidencia_id": evidencia["id"],
                    "evidencia_url": evidencia["url"],
                    "evidencia_descripcion": evidencia["descripcion"],
                },
            )


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

    # Primero se guarda el resultado en Analytics y después se publica: así el
    # listado de VI-17 no depende de que exista un consumidor de la cola.
    _persistir_recomendaciones(salidas)

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

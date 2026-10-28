"""Adaptador de mensajes RabbitMQ para recomendaciones de consolidación."""

import json
import logging
from datetime import datetime
from decimal import Decimal

import pika
from django.db import IntegrityError, transaction

from analytics.jobs import procesar_evento_solapamiento
from analytics.models import (
    CAMPOS_IDENTIDAD_RECOMENDACION,
    RecomendacionConsolidacion,
)

EXCHANGE = "suscripciones"
ROUTING_KEY_SALIDA = "recomendacion.consolidacion_generada.v1"

log = logging.getLogger(__name__)


def _datos_persistencia(salida) -> dict:
    datos = salida["datos"]
    candidata = datos["suscripcion_candidata"]
    ahorro = datos["ahorro_potencial"]
    evidencia = datos["evidencia"]
    ocurrido_en = datetime.fromisoformat(
        salida["ocurrido_en"].replace("Z", "+00:00")
    )
    ocurrido_en_origen = datetime.fromisoformat(
        datos.get("ocurrido_en_origen", salida["ocurrido_en"]).replace("Z", "+00:00")
    )
    return {
        "organizacion_id": salida["organizacion_id"],
        "evento_origen_id": datos["evento_origen_id"],
        "correlation_id": salida["correlation_id"],
        "ocurrido_en": ocurrido_en,
        "ocurrido_en_origen": ocurrido_en_origen,
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
    }


def _actualizar_vigente(existente, campos) -> None:
    """Actualiza la fila equivalente sin revivir descartes ni retroceder.

    ``estado`` no forma parte de ``campos`` a propósito: una reentrega no debe
    revivir una recomendación que VI-18 ya descartó. Si el snapshot entrante es
    anterior al ya consolidado, se ignora para no pisar datos más recientes.
    """
    if campos["ocurrido_en_origen"] < existente.ocurrido_en_origen:
        return
    for campo, valor in campos.items():
        setattr(existente, campo, valor)
    # ``update_fields`` no dispara ``auto_now`` si el campo no aparece.
    existente.save(update_fields=[*campos, "actualizado_en"])


def _persistir_recomendacion(salida) -> None:
    campos = _datos_persistencia(salida)
    identidad = {
        campo: campos[campo] for campo in CAMPOS_IDENTIDAD_RECOMENDACION
    }

    existente = (
        RecomendacionConsolidacion.objects.select_for_update()
        .filter(**identidad)
        .first()
    )
    if existente is not None:
        _actualizar_vigente(existente, campos)
        return

    try:
        # La restricción única de la identidad de negocio es la última defensa
        # ante dos entregas concurrentes. El savepoint permite recuperarse del
        # choque y actualizar la fila que ganó la carrera.
        with transaction.atomic():
            RecomendacionConsolidacion.objects.create(
                id=salida["id"],
                **campos,
            )
    except IntegrityError:
        existente = (
            RecomendacionConsolidacion.objects.select_for_update()
            .filter(**identidad)
            .first()
        )
        if existente is None:
            raise
        _actualizar_vigente(existente, campos)


def _persistir_recomendaciones(salidas) -> None:
    """Persiste las salidas de VI-20 consolidando por identidad de hallazgo.

    Un replay exacto del mismo evento reusa el ``id`` de salida y es
    idempotente. Un evento nuevo que describe el mismo hallazgo (misma
    organización, tipo, suscripción candidata y evidencia) actualiza la
    vigente en vez de crear una copia. La operación es atómica y la restricción
    única por identidad impide dos filas equivalentes ante eventos concurrentes.
    """
    with transaction.atomic():
        for salida in salidas:
            _persistir_recomendacion(salida)


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

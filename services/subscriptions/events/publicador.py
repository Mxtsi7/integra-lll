"""Publicador de eventos de dominio en RabbitMQ (ADR-003).

El sobre es el de shared/events/catalogo.md, sin inventar campos: un cambio
acá es un cambio de contrato para todo el equipo.

── Por qué la conexión se reutiliza ──────────────────────────────────────────
Abrir una BlockingConnection cuesta un handshake TCP más el de AMQP: decenas
de milisegundos. Si se abriera una por petición, publicar saldría MÁS CARO que
el trabajo que estamos sacando del camino crítico, y la comparación con y sin
cola daría al revés por un detalle de implementación, no por la arquitectura.

Se guarda una conexión por proceso. gunicorn corre con --workers 2, que son
procesos separados, así que cada uno tiene la suya y no se comparte entre
hilos (pika.BlockingConnection no es segura entre hilos).
"""

import json
import logging
import uuid
from datetime import datetime, timezone

import pika
from django.conf import settings

registro = logging.getLogger(__name__)

EXCHANGE = "suscripciones"

_conexion = None
_canal = None


def _ahora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sobre(evento: str, datos: dict, organizacion_id, correlation_id: str = "") -> dict:
    """Arma el sobre común del catálogo. Separado para poder probarlo solo."""
    return {
        "evento": evento,
        "version": 1,
        "id": str(uuid.uuid4()),
        "ocurrido_en": _ahora(),
        "correlation_id": correlation_id or "",
        "organizacion_id": str(organizacion_id),
        "datos": datos,
    }


def _canal_vivo():
    """Devuelve un canal abierto, reconectando si se cayó."""
    global _conexion, _canal
    if _conexion is not None and _conexion.is_open and _canal is not None and _canal.is_open:
        return _canal
    _conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    _canal = _conexion.channel()
    # durable=True: el exchange sobrevive a un reinicio del broker. Lo declaran
    # publicador y consumidor por igual; declarar un exchange que ya existe con
    # los mismos parámetros no hace nada.
    _canal.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    return _canal


def cerrar() -> None:
    """Cierra la conexión. Para los tests y para un apagado ordenado."""
    global _conexion, _canal
    try:
        if _conexion is not None and _conexion.is_open:
            _conexion.close()
    finally:
        _conexion = None
        _canal = None


def publicar(evento: str, datos: dict, organizacion_id, correlation_id: str = "") -> dict:
    """Publica un evento. Reintenta una vez si la conexión estaba muerta."""
    cuerpo = sobre(evento, datos, organizacion_id, correlation_id)
    crudo = json.dumps(cuerpo).encode("utf-8")
    for intento in (1, 2):
        try:
            _canal_vivo().basic_publish(
                exchange=EXCHANGE,
                routing_key=evento,
                body=crudo,
                properties=pika.BasicProperties(
                    delivery_mode=2,          # persistente: sobrevive al reinicio
                    content_type="application/json",
                ),
            )
            return cuerpo
        except (pika.exceptions.AMQPError, OSError):
            cerrar()
            if intento == 2:
                raise
            registro.warning("RabbitMQ se cayó al publicar %s; reconectando", evento)
    return cuerpo

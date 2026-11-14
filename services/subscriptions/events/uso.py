"""Publicación fiable de uso de recolectores (S3-VI-07).

Punto de integración para la recepción autenticada de S3-MX-26..31. La
recepción valida el cuerpo canónico `uso-recolectores-v1`, persiste el hecho y
llama a :func:`registrar_uso` **dentro de la misma transacción**. El evento
queda en el outbox; ``events.despacho`` lo publica después del commit en el
exchange dedicado ``uso.eventos`` con routing key ``uso.registrado``.

Por qué el sobre no usa el ``id`` del outbox
--------------------------------------------
El contrato interno exige ``id == datos.event_id``: el identificador del hecho
es el que permite deduplicar en Analytics. El ``id`` de ``OutboxEvento`` es
solo la clave de la fila local y puede repetirse entre tenants, así que no se
publica como ``id`` del sobre.

Por qué el destino y el usuario van en ``datos``
------------------------------------------------
El cuerpo HTTP del recolector no lleva identidad ni suscripción. La recepción
las resuelve desde la sesión y la ruta; el sobre las añade para que Analytics
sepa a quién pertenece el hecho. ``organizacion_id`` viaja en el sobre común,
no duplicado dentro de ``datos``.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from datetime import timezone as datetime_timezone
from typing import Any

import pika
from django.conf import settings
from django.utils import timezone

from app.models import OutboxEvento

EXCHANGE_USO = "uso.eventos"
EXCHANGE_DLX_USO = "uso.eventos.dlx"
COLA_USO = "analytics.uso.cola"
COLA_FALLOS_USO = "analytics.uso.fallos"
ROUTING_KEY_USO = "uso.registrado"
EVENTO_USO = "uso.registrado"
VERSION_USO = 1
MAX_REINTENTOS = 5

#: Campos que el cuerpo canónico prohíbe y que solo la recepción puede añadir.
CAMPOS_RESERVADOS = frozenset({"organizacion_id", "suscripcion_id", "usuario_id"})


def _uuid(valor: Any, campo: str) -> uuid.UUID:
    if isinstance(valor, uuid.UUID):
        return valor
    try:
        return uuid.UUID(str(valor))
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValueError(f"`{campo}` no es un UUID: {valor!r}") from exc


def _correlation_id(valor: Any) -> uuid.UUID:
    if valor is None:
        return uuid.uuid4()
    return _uuid(valor, "correlation_id")


def _iso_utc(valor) -> str:
    """Serializa un instante en UTC con precisión de milisegundos.

    El contrato interno solo admite 1–3 dígitos fraccionarios antes de ``Z``
    (``validacion.ts``). Python emite 6 cuando el ``datetime`` trae
    microsegundos, así que se recorta aquí: el sobre no puede llevar una
    precisión que el consumidor rechaza.
    """
    return (
        valor.astimezone(datetime_timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def datos_uso(
    *,
    evento: Mapping[str, Any],
    suscripcion_id: Any,
    usuario_id: Any = None,
) -> dict[str, Any]:
    """Arma ``datos``: cuerpo canónico + destino/identidad autenticados.

    Rechaza que el cuerpo traiga campos reservados. La recepción ya los
    resuelve; aceptarlos desde el recolector permitiría falsificar el tenant o
    el destino.
    """
    if not isinstance(evento, Mapping):
        raise ValueError("el cuerpo canónico debe ser un objeto JSON")

    repetidos = CAMPOS_RESERVADOS.intersection(evento)
    if repetidos:
        raise ValueError(
            "el cuerpo canónico no admite "
            + ", ".join(sorted(repetidos))
        )

    datos = dict(evento)
    datos["suscripcion_id"] = str(_uuid(suscripcion_id, "suscripcion_id"))
    if usuario_id is not None:
        datos["usuario_id"] = str(_uuid(usuario_id, "usuario_id"))
    return datos


def registrar_uso(
    *,
    organizacion_id: Any,
    suscripcion_id: Any,
    evento: Mapping[str, Any],
    usuario_id: Any = None,
    correlation_id: Any = None,
) -> OutboxEvento:
    """Deja el hecho aceptado en el outbox, en la transacción del llamador.

    No publica aquí: el despachador lo hace después del commit. Así una
    aceptación nunca queda huérfana si RabbitMQ está caído.
    """
    return OutboxEvento.objects.create(
        organizacion_id=_uuid(organizacion_id, "organizacion_id"),
        evento=EVENTO_USO,
        version=VERSION_USO,
        ocurrido_en=timezone.now(),
        correlation_id=_correlation_id(correlation_id),
        datos=datos_uso(
            evento=evento,
            suscripcion_id=suscripcion_id,
            usuario_id=usuario_id,
        ),
    )


def crear_sobre_uso(evento: OutboxEvento) -> dict[str, Any]:
    """Convierte una fila del outbox al sobre interno de ``uso.registrado``."""
    datos = evento.datos
    if not isinstance(datos, Mapping) or "event_id" not in datos:
        raise ValueError("el outbox de uso no contiene `datos.event_id`")

    return {
        "evento": EVENTO_USO,
        "version": VERSION_USO,
        "id": str(_uuid(datos["event_id"], "datos.event_id")),
        "ocurrido_en": _iso_utc(evento.ocurrido_en),
        "correlation_id": str(evento.correlation_id),
        "organizacion_id": str(evento.organizacion_id),
        "datos": datos,
    }


def declarar_uso(canal) -> None:
    """Declara exchange, DLX, colas y enlace del consumo de uso.

    Debe coincidir con ``services/analytics-uso/src/infraestructura/topologia.ts``.
    El publicador declara la cola para que un evento publicado antes de que
    arranque el worker no se pierda como ``UnroutableError``.
    """
    canal.exchange_declare(
        exchange=EXCHANGE_USO, exchange_type="topic", durable=True
    )
    canal.exchange_declare(
        exchange=EXCHANGE_DLX_USO, exchange_type="topic", durable=True
    )

    canal.queue_declare(
        queue=COLA_FALLOS_USO,
        durable=True,
        arguments={"x-queue-type": "quorum"},
    )
    canal.queue_bind(
        exchange=EXCHANGE_DLX_USO,
        queue=COLA_FALLOS_USO,
        routing_key="#",
    )

    canal.queue_declare(
        queue=COLA_USO,
        durable=True,
        arguments={
            "x-queue-type": "quorum",
            "x-dead-letter-exchange": EXCHANGE_DLX_USO,
            "x-dead-letter-routing-key": ROUTING_KEY_USO,
            "x-delivery-limit": MAX_REINTENTOS,
        },
    )
    canal.queue_bind(
        exchange=EXCHANGE_USO,
        queue=COLA_USO,
        routing_key=ROUTING_KEY_USO,
    )


def publicar_uso(evento: OutboxEvento) -> None:
    """Publica un evento de uso con confirms y ``mandatory``.

    Igual que el publicador MX-21: si el broker no confirma o no hay ruta, la
    excepción sube y el despachador reintenta el outbox.
    """
    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        declarar_uso(canal)
        canal.confirm_delivery()
        canal.basic_publish(
            exchange=EXCHANGE_USO,
            routing_key=ROUTING_KEY_USO,
            body=json.dumps(
                crear_sobre_uso(evento), separators=(",", ":")
            ).encode("utf-8"),
            properties=pika.BasicProperties(
                delivery_mode=pika.DeliveryMode.Persistent,
                content_type="application/json",
                message_id=str(evento.datos["event_id"]),
                correlation_id=str(evento.correlation_id),
                type=EVENTO_USO,
                headers={"version": VERSION_USO},
            ),
            mandatory=True,
        )
    finally:
        if conexion.is_open:
            conexion.close()

"""La respuesta a una orden de cobro: `candidato.aplicado` v1 (RF-14).

El contrato está en `shared/contratos/candidato_aplicado.py`. Acá están las
dos mitades que son de este servicio:

  · `registrar_resultado` deja la respuesta en el outbox. `aplicar` la llama
    dentro de SU transacción, así que no hay orden aplicada sin respuesta ni
    respuesta de algo que no quedó. El consumidor la llama, en una
    transacción propia, cuando aparta una orden a la cola de fallos.
  · `publicar_resultado` la saca por el exchange de órdenes. `despacho.py` la
    elige por el nombre del evento, igual que hace con el uso.
"""

from __future__ import annotations

import json
import uuid

import pika
from django.conf import settings
from django.utils import timezone

from app.models import OutboxEvento
from events.publicador import crear_payload
from shared.contratos import candidato_aplicado as contrato

__all__ = ["EVENTO_RESULTADO", "publicar_resultado", "registrar_resultado", "ya_contestada"]

EVENTO_RESULTADO = contrato.EVENTO


class ResultadoSinContrato(ValueError):
    """La respuesta armada no cumple el contrato: no se publica."""


def _uuid_o_none(valor) -> str | None:
    return str(valor) if valor is not None else None


def ya_contestada(organizacion_id, candidato_id) -> bool:
    """Si esa orden ya tiene respuesta en el outbox, publicada o no."""
    return OutboxEvento.objects.filter(
        organizacion_id=organizacion_id,
        evento=EVENTO_RESULTADO,
        datos__candidato_id=str(candidato_id),
    ).exists()


def registrar_resultado(
    *,
    organizacion_id,
    correlation_id,
    candidato_id,
    orden_id,
    resultado: str,
    motivo: str,
    suscripcion_id=None,
    cobro_id=None,
) -> OutboxEvento:
    """Deja la respuesta en el outbox. Valida ANTES de escribir.

    Una respuesta que no cumple el contrato la apartaría connectors a su cola
    de fallos y la orden quedaría «enviada» para siempre: mejor que reviente
    acá, donde se ve.
    """
    fila = OutboxEvento(
        organizacion_id=organizacion_id,
        evento=EVENTO_RESULTADO,
        version=contrato.VERSION,
        ocurrido_en=timezone.now(),
        correlation_id=uuid.UUID(str(correlation_id)),
        datos={
            "candidato_id": str(candidato_id),
            "orden_id": str(orden_id),
            "resultado": resultado,
            "motivo": motivo,
            "suscripcion_id": _uuid_o_none(suscripcion_id),
            "cobro_id": _uuid_o_none(cobro_id),
        },
    )
    fallos = contrato.errores(crear_payload(fila))
    if fallos:
        raise ResultadoSinContrato("; ".join(fallos[:3]))
    fila.save()
    return fila


def publicar_resultado(evento: OutboxEvento) -> None:
    """Publica una respuesta y vuelve solo si el broker la confirmó.

    Mismas reglas que `publicador.publicar`: `confirm_delivery()` +
    `mandatory=True`, y si no lanzó, quedó guardada.
    """
    sobre = crear_payload(evento)
    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        contrato.declarar(canal)
        canal.confirm_delivery()
        canal.basic_publish(
            exchange=contrato.EXCHANGE,
            routing_key=contrato.ROUTING_KEY,
            body=json.dumps(sobre, separators=(",", ":")).encode("utf-8"),
            properties=pika.BasicProperties(
                delivery_mode=pika.DeliveryMode.Persistent,
                content_type="application/json",
                message_id=sobre["id"],
                correlation_id=sobre["correlation_id"],
                type=evento.evento,
                headers={"version": evento.version},
            ),
            mandatory=True,
        )
    finally:
        if conexion.is_open:
            conexion.close()

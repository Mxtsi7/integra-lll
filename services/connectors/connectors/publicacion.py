"""Drena el outbox de connectors a RabbitMQ (RF-14).

Hasta acá, confirmar un candidato dejaba la orden de cobro guardada en
`connectors_event_outbox` y nadie la publicaba. Esto es quien la publica:
una tarea periódica del worker (`connectors.tasks.despachar_eventos`) que toma
las filas pendientes, las manda al exchange `connectors.eventos` y las marca
publicadas solo cuando el broker CONFIRMÓ el mensaje.

── Es el mismo despacho que el de subscriptions, a propósito ────────────────
`services/subscriptions/events/despacho.py` ya resolvió las tres cosas que
importan y acá se repiten igual:

  · cada fila se toma con `SELECT ... FOR UPDATE SKIP LOCKED`: dos pasadas
    que se pisan (beat atrasado, dos workers) no publican la misma fila dos
    veces ni se esperan entre ellas;
  · `confirm_delivery()` + `mandatory=True`: si el broker no la acepta o no
    hay cola enlazada, `basic_publish` lanza y la fila sigue pendiente;
  · un fallo deja la fila con espera creciente (5 s, 10 s, 20 s… hasta 15
    min) en vez de reintentarla en cada pasada.

Al menos una vez, no exactamente una: si el proceso muere entre que el broker
confirma y el `UPDATE publicado_en`, la fila se vuelve a publicar con el
MISMO `id` de sobre. El consumidor lo sabe (la fila del candidato es única).

── Sin broker configurado no se toca nada ───────────────────────────────────
La API de connectors (hoy dentro del pod web) no publica y no recibe
`RABBITMQ_URL`. Si el worker tampoco la tiene, la pasada termina sin tocar
ninguna fila: quedan pendientes, durables, y salen cuando llegue la variable.
Marcarlas como fallidas solo inflaría `intentos` por un problema de
configuración.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from datetime import timezone as datetime_timezone

import pika
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from shared.contratos import candidato_confirmado as contrato

from .models import OutboxEvento

registro = logging.getLogger(__name__)

TAMANO_LOTE = 100
REINTENTO_MAXIMO_SEGUNDOS = 900


class EventoSinContrato(ValueError):
    """Una fila del outbox que no es un evento publicable por este módulo."""


def crear_sobre(evento: OutboxEvento) -> dict:
    """El sobre común: el mismo formato que MX-21, con los datos de la fila."""
    return {
        "evento": evento.evento,
        "version": evento.version,
        "id": str(evento.id),
        "ocurrido_en": (
            evento.ocurrido_en.astimezone(datetime_timezone.utc).isoformat().replace("+00:00", "Z")
        ),
        "correlation_id": str(evento.correlation_id),
        "organizacion_id": str(evento.organizacion_id),
        "datos": evento.datos,
    }


def _clave(evento: OutboxEvento) -> str:
    if (evento.evento, evento.version) != (contrato.EVENTO, contrato.VERSION):
        raise EventoSinContrato(f"{evento.evento} v{evento.version}")
    return contrato.ROUTING_KEY


def publicar(evento: OutboxEvento) -> None:
    """Publica una fila y vuelve solo si el broker la confirmó.

    Con `confirm_delivery()`, pika 1.x hace que `basic_publish` devuelva None
    y LANCE si el broker rechaza (`NackError`) o no hay cola (`UnroutableError`).
    No hay valor de retorno que mirar: si no lanzó, quedó guardado.
    """
    sobre = crear_sobre(evento)
    fallos = contrato.errores(sobre)
    if fallos:
        # Mandar un sobre que el consumidor va a apartar a su cola de fallos
        # es perder la orden en otro lado. Mejor que se quede acá, visible.
        raise EventoSinContrato("; ".join(fallos[:3]))

    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        contrato.declarar(canal)
        canal.confirm_delivery()
        canal.basic_publish(
            exchange=contrato.EXCHANGE,
            routing_key=_clave(evento),
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


def _espera(intentos: int) -> int:
    return min(5 * (2 ** min(intentos - 1, 8)), REINTENTO_MAXIMO_SEGUNDOS)


def despachar_pendientes(*, publicar_uno=None) -> dict[str, int]:
    """Publica lo pendiente. Devuelve cuántas salieron y cuántas quedaron."""
    # Se busca al llamar, no como valor por omisión: así un reemplazo del
    # módulo (en una prueba o en un parche) es lo que de verdad se usa.
    publicar_uno = publicar_uno or publicar
    if not getattr(settings, "RABBITMQ_URL", ""):
        pendientes = OutboxEvento.objects.filter(publicado_en__isnull=True).count()
        if pendientes:
            registro.warning("outbox sin publicar: falta RABBITMQ_URL (%s pendientes)", pendientes)
        return {"publicados": 0, "reintentados": 0, "sin_broker": pendientes}

    ids = list(
        OutboxEvento.objects.filter(publicado_en__isnull=True, siguiente_intento__lte=timezone.now())
        .order_by("creado_en", "id")
        .values_list("id", flat=True)[:TAMANO_LOTE]
    )
    publicados = reintentados = 0
    for evento_id in ids:
        with transaction.atomic():
            evento = (
                OutboxEvento.objects.select_for_update(skip_locked=True)
                .filter(pk=evento_id, publicado_en__isnull=True, siguiente_intento__lte=timezone.now())
                .first()
            )
            if evento is None:
                # La tomó otra pasada, o ya salió.
                continue
            try:
                publicar_uno(evento)
            except (pika.exceptions.AMQPError, OSError, EventoSinContrato) as error:
                evento.intentos += 1
                espera = _espera(evento.intentos)
                evento.siguiente_intento = timezone.now() + timedelta(seconds=espera)
                evento.ultimo_error = type(error).__name__
                evento.save(update_fields=("intentos", "siguiente_intento", "ultimo_error"))
                reintentados += 1
                registro.error(
                    "falló la publicación: evento=%s id=%s error=%s reintento_s=%s",
                    evento.evento, evento.id, evento.ultimo_error, espera,
                )
            else:
                evento.publicado_en = timezone.now()
                evento.ultimo_error = ""
                evento.save(update_fields=("publicado_en", "ultimo_error"))
                publicados += 1
    return {"publicados": publicados, "reintentados": reintentados, "sin_broker": 0}

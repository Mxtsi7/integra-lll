"""Recoge lo que subscriptions hizo con cada orden de cobro (RF-14).

La vuelta de `publicacion.py`. subscriptions contesta cada orden con
`candidato.aplicado` v1 (contrato en `shared/contratos/candidato_aplicado.py`)
en la cola `connectors.candidatos.resultados`, y esto la lee y lo deja en el
candidato: `resultado_aplicacion`, `motivo_aplicacion` y `orden_aplicada_en`.
Con eso la web deja de decir «enviada, revisa Suscripciones» y dice lo que
pasó: «aplicada» o «no se pudo aplicar».

── Por qué una tarea periódica con `basic_get` y no un consumidor ───────────
connectors no tiene un proceso que escuche RabbitMQ: tiene el worker de
Celery, que ya publica las órdenes cada 10 s. Un consumidor de verdad sería
otro Deployment, otra política de red y otro proceso que vigilar para algo
que llega de a pocos y que no apura: la persona mira la lista minutos
después, no milisegundos. Así que el mismo worker, en cada pasada, saca lo que
haya con `basic_get` (AMQP lo admite tal cual) y termina.

── Las reglas, las mismas del consumidor de subscriptions ───────────────────
  · ack SOLO después de que el cambio quedó escrito en la base;
  · la base caída: el mensaje vuelve a la cola (`requeue=True`) y la pasada
    termina; la siguiente lo intenta de nuevo;
  · un sobre que no cumple el contrato, o que falla al guardarse por algo
    que no es pasajero: a la cola de fallos (`requeue=False` +
    `x-dead-letter-exchange`), donde queda para mirarlo. Devolverlo a la cola
    no serviría: RabbitMQ lo deja PRIMERO, `basic_get` lo sacaría en cada
    pasada y las respuestas de atrás no llegarían nunca;
  · el broker caído (al conectar o a la mitad): la pasada termina sin
    reventar la tarea. Lo que no alcanzó a confirmarse vuelve solo a la cola
    al cerrarse el canal, y como guardar es idempotente, repetirlo no cambia
    nada.

── Idempotente ──────────────────────────────────────────────────────────────
Se escribe con un UPDATE con condición, no leyendo y guardando:

    aplicado   pisa cualquier cosa que no sea ya `aplicado`
    fallido    solo si todavía no había respuesta

Una reentrega no cambia nada. Un `aplicado` después de un `fallido` sí cambia:
quiere decir que alguien reprocesó la cola de fallos de subscriptions y esta
vez salió. Un `fallido` después de un `aplicado` no puede pasar (allá no se
contesta fallido a algo ya contestado) y si pasara, no pisa la verdad.

Una respuesta de un candidato que no existe (o de otra organización) no toca
nada y se confirma igual: reintentarla no la va a hacer existir.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

import pika
from django.conf import settings
from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError
from django.utils import timezone

from shared.contratos import candidato_aplicado as contrato

from .models import CobroCandidato

registro = logging.getLogger(__name__)

#: Cuántas respuestas, como mucho, en una pasada. Lo que sobre sale en la otra.
TAMANO_LOTE = 100

ERRORES_PASAJEROS = (OperationalError, InterfaceError)


@dataclass(frozen=True)
class Desenlace:
    """Qué hacer con el mensaje. `reintentar` solo importa si no se confirma."""

    confirmar: bool
    motivo: str
    reintentar: bool = False


def _instante(texto: str) -> datetime:
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))


def aplicar_respuesta(sobre: dict) -> int:
    """Deja la respuesta en su candidato. Devuelve cuántas filas cambió (0 o 1)."""
    datos = sobre["datos"]
    candidatos = CobroCandidato.objects.filter(
        organizacion_id=uuid.UUID(sobre["organizacion_id"]),
        pk=uuid.UUID(datos["candidato_id"]),
        estado=CobroCandidato.Estado.CONFIRMADO,
    )
    if datos["resultado"] == contrato.APLICADO:
        candidatos = candidatos.exclude(resultado_aplicacion=CobroCandidato.ResultadoAplicacion.APLICADO)
    else:
        candidatos = candidatos.filter(resultado_aplicacion="")
    # Un solo UPDATE con la condición en el WHERE: no hay lectura que se
    # pueda quedar vieja entre dos pasadas que se crucen.
    return candidatos.update(
        resultado_aplicacion=datos["resultado"],
        motivo_aplicacion=datos["motivo"],
        orden_aplicada_en=_instante(sobre["ocurrido_en"]),
        actualizado_en=timezone.now(),
    )


def procesar(cuerpo: bytes) -> Desenlace:
    try:
        sobre = json.loads(cuerpo)
    except ValueError as error:
        return Desenlace(confirmar=False, motivo=f"no es JSON: {error}")
    fallos = contrato.errores(sobre)
    if fallos:
        return Desenlace(confirmar=False, motivo="no cumple candidato.aplicado v1 — " + "; ".join(fallos[:5]))
    try:
        cambiadas = aplicar_respuesta(sobre)
    except ERRORES_PASAJEROS as error:
        return Desenlace(confirmar=False, motivo=f"base no disponible: {error}", reintentar=True)
    except Exception as error:  # noqa: BLE001
        # No mejora reintentando, y reencolado bloquearía la cola: ver el docstring.
        return Desenlace(confirmar=False, motivo=f"no se pudo guardar: {type(error).__name__}: {error}")
    return Desenlace(confirmar=True, motivo="guardada" if cambiadas else "sin_cambios")


def recoger_pendientes(*, conectar=None) -> dict[str, int]:
    """Saca de la cola lo que haya, hasta `TAMANO_LOTE`. Sin broker, nada."""
    if not getattr(settings, "RABBITMQ_URL", ""):
        return {"guardadas": 0, "sin_cambios": 0, "apartadas": 0, "sin_broker": 1}
    conectar = conectar or (lambda: pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL)))
    cuenta = {"guardadas": 0, "sin_cambios": 0, "apartadas": 0, "sin_broker": 0}
    try:
        conexion = conectar()
    except (pika.exceptions.AMQPError, OSError) as error:
        registro.warning("respuestas sin recoger: broker no disponible (%s)", type(error).__name__)
        cuenta["sin_broker"] = 1
        return cuenta
    try:
        canal = conexion.channel()
        contrato.declarar(canal)
        for _ in range(TAMANO_LOTE):
            metodo, _propiedades, cuerpo = canal.basic_get(queue=contrato.COLA, auto_ack=False)
            if metodo is None:
                break
            close_old_connections()
            desenlace = procesar(cuerpo)
            if desenlace.confirmar:
                canal.basic_ack(delivery_tag=metodo.delivery_tag)
                cuenta["guardadas" if desenlace.motivo == "guardada" else "sin_cambios"] += 1
                continue
            canal.basic_nack(delivery_tag=metodo.delivery_tag, requeue=desenlace.reintentar)
            if desenlace.reintentar:
                # La base no está: seguir sacando mensajes solo los haría dar vueltas.
                registro.warning("respuesta.reencolada %s", desenlace.motivo)
                break
            cuenta["apartadas"] += 1
            registro.error("respuesta.apartada %s", desenlace.motivo)
    except (pika.exceptions.AMQPError, OSError) as error:
        registro.warning("respuestas: el broker se cortó a la mitad de la pasada (%s)", type(error).__name__)
        cuenta["sin_broker"] = 1
    finally:
        if conexion.is_open:
            conexion.close()
    return cuenta

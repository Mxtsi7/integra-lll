"""Publicar `alerta.activada.v2` desde el outbox (FE-24 / MX-21).

Arma el sobre, lo manda al exchange con confirms y `mandatory`, y recién
entonces marca la fila como publicada. El orden importa: marcar primero y
publicar después perdería el evento ante cualquier corte, y el outbox no
tendría nada que reintentar.

── Qué garantiza y qué no ──────────────────────────────────────────────────
Con `confirm_delivery()` y `mandatory=True`:

    sin cola enlazada que calce   → `UnroutableError`. La fila queda
                                    pendiente y se reintenta. Sin
                                    `mandatory`, un topic descarta el mensaje
                                    en silencio y nadie se enteraría.
    el broker no confirma         → excepción. Igual: queda pendiente.
    el broker confirma            → se marca publicada.

Lo que NO garantiza —y conviene decirlo porque es la confusión habitual— es
que el efecto del consumidor haya ocurrido. Un confirm dice "el broker lo
tiene", no "alguien lo procesó". De eso se encarga el inbox del otro lado.

── Al menos una vez, nunca cero ────────────────────────────────────────────
Si el proceso muere entre el confirm del broker y el `UPDATE` de
`publicado_en`, la fila sigue pendiente y el próximo pase la vuelve a
publicar. O sea que un mensaje puede salir dos veces, con el MISMO `id`
(el de la fila), y el inbox del consumidor lo descarta. Preferir el duplicado
deduplicable a la pérdida es la decisión de siempre en esta arquitectura.
"""

from __future__ import annotations

import datetime as dt
import json
import logging

import pika
from django.conf import settings
from django.utils import timezone

from notifications.models import AlertaPorEntregar
from shared.events.contrato import EXCHANGE, routing_key
from shared.events.validacion import errores as errores_de_contrato

from .topologia import declarar

log = logging.getLogger(__name__)

#: Cuántas filas se publican por pase. Acota la transacción y el tiempo que
#: el proceso tiene la conexión abierta.
POR_PASE = 200


def crear_sobre(entrega: AlertaPorEntregar, *, ahora=None) -> dict:
    """El sobre del catálogo para una entrega.

    `ocurrido_en` es el instante de la PUBLICACIÓN, no el de la alerta: el
    hecho que se anuncia es "esta alerta venció y hay que entregarla", y se
    anuncia ahora. `programada_para` lleva cuándo venció, y el contrato exige
    que sea anterior o igual — que es justamente lo que se comprueba abajo.
    """
    ahora = ahora or timezone.now()
    return {
        "evento": AlertaPorEntregar.evento,
        "version": AlertaPorEntregar.version,
        "id": str(entrega.id),
        "ocurrido_en": _z(ahora),
        "correlation_id": str(entrega.correlation_id),
        "organizacion_id": str(entrega.organizacion_id),
        "datos": {
            "alerta_id": str(entrega.alerta_id),
            "suscripcion_id": str(entrega.alerta.suscripcion_id),
            "usuario_id": entrega.usuario_id,
            "tipo": entrega.alerta.tipo,
            "programada_para": _z(entrega.programada_para),
        },
    }


def _z(instante) -> str:
    """RFC3339 en UTC terminado en Z, como pide el esquema.

    `isoformat()` de un datetime con zona da `+00:00`, y el esquema exige
    `Z` (tiene un `pattern: "Z$"`). No es cosmético: un sobre con `+00:00`
    no valida, así que se iría a la cola de fallos.
    """
    return instante.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


class SobrePropioInvalido(RuntimeError):
    """El sobre que armamos NOSOTROS no cumple el contrato.

    Es un error de programación, no del productor de enfrente: se levanta en
    vez de publicar, porque publicar basura obliga al consumidor a rechazarla
    y el problema aparecería del otro lado de la cola, donde es mucho más
    difícil de ubicar.
    """


def publicar_pendientes(*, limite: int = POR_PASE, ahora=None) -> dict:
    """Publica las entregas sin `publicado_en`. Devuelve un resumen.

    Las entregas de una alerta que la persona ya revisó se publican igual: el
    evento dice que la alerta venció, y eso pasó. Quién decide no entregarla
    es el worker de entrega (FE-22), que es el que conoce los límites y el
    horario de descanso.
    """
    pendientes = list(
        AlertaPorEntregar.objects.select_related("alerta")
        .filter(publicado_en__isnull=True)
        .order_by("creado_en")[:limite]
    )
    resumen = {"publicadas": 0, "fallidas": 0, "pendientes": len(pendientes)}
    if not pendientes:
        return resumen

    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        # La misma topología que declara el consumidor. Declarar es
        # idempotente, y hace falta: si la cola de entregas todavía no existe,
        # `mandatory=True` haría fallar toda publicación por no enrutable.
        declarar(canal)
        canal.confirm_delivery()

        for entrega in pendientes:
            try:
                _publicar_una(canal, entrega, ahora=ahora)
            except Exception as error:  # noqa: BLE001
                # Un fallo de una no debe detener a las demás: queda anotado
                # en la fila y el próximo pase la reintenta.
                resumen["fallidas"] += 1
                AlertaPorEntregar.objects.filter(pk=entrega.pk).update(
                    intentos=entrega.intentos + 1,
                    ultimo_error=f"{type(error).__name__}: {error}"[:500],
                )
                log.warning("entrega %s no se pudo publicar: %s", entrega.pk, error)
            else:
                resumen["publicadas"] += 1
    finally:
        conexion.close()
    return resumen


def _publicar_una(canal, entrega: AlertaPorEntregar, *, ahora=None) -> None:
    sobre = crear_sobre(entrega, ahora=ahora)
    fallos = errores_de_contrato(sobre)
    if fallos:
        raise SobrePropioInvalido(
            "el sobre armado no cumple MX-21 v2 — " + "; ".join(fallos[:5])
        )

    canal.basic_publish(
        exchange=EXCHANGE,
        routing_key=routing_key(entrega),
        body=json.dumps(sobre, ensure_ascii=False).encode("utf-8"),
        properties=pika.BasicProperties(
            content_type="application/json",
            delivery_mode=pika.DeliveryMode.Persistent,
            message_id=sobre["id"],
            correlation_id=sobre["correlation_id"],
        ),
        mandatory=True,
    )
    # Recién acá, y condicionado a que siga pendiente: si otro pase la publicó
    # mientras tanto, este no mueve la fecha.
    AlertaPorEntregar.objects.filter(pk=entrega.pk, publicado_en__isnull=True).update(
        publicado_en=timezone.now(), ultimo_error=""
    )

"""El efecto de un evento de dominio en Notifications (FE-24).

Un evento de suscripción hace DOS cosas acá, y las dos en la misma
transacción que la marca del inbox:

    1. actualiza la proyección (`proyeccion.aplicar`), que es de dónde sale
       lo que el generador de FE-17/FE-18 va a avisar;
    2. juzga las alertas ya creadas contra el estado nuevo
       (`anulacion.revisar`), que es FE-23.

El orden no es casual: la anulación se decide contra el estado VIGENTE de la
suscripción, así que primero se aplica el evento y después se juzgan las
alertas. Al revés se juzgarían contra el estado viejo y la alerta que acaba
de quedar falsa sobreviviría hasta el próximo evento.

── Un evento viejo no anula nada ───────────────────────────────────────────
`aplicar` devuelve False cuando el evento es más viejo que la proyección
(reentrega fuera de orden). En ese caso NO se revisan las alertas: el estado
no cambió, así que no hay nada que juzgar, y hacerlo sería anular alertas con
el `evento_id` de un mensaje que no cambió nada — una pista falsa para quien
después pregunte por qué desapareció su alerta.
"""

from __future__ import annotations

import logging

from notifications import anulacion, proyeccion
from notifications.models import SuscripcionVigilada

log = logging.getLogger(__name__)


def aplicar(sobre: dict) -> bool:
    """Aplica el evento y limpia las alertas que dejó falsas.

    Devuelve si cambió algo. Lo llama `entrada.recibir` dentro de la
    transacción del inbox: si esto lanza, no queda ni la proyección ni la
    marca, y RabbitMQ vuelve a entregar el mensaje.
    """
    cambio = proyeccion.aplicar(sobre)
    if not cambio:
        return False

    datos = sobre.get("datos") or {}
    suscripcion = SuscripcionVigilada.objects.filter(
        organizacion_id=sobre["organizacion_id"],
        suscripcion_id=datos.get("suscripcion_id"),
    ).first()
    if suscripcion is None:
        # No debería pasar: `aplicar` acaba de crearla o actualizarla en esta
        # misma transacción. Si pasa, el evento igual se da por procesado (la
        # proyección cambió) pero queda dicho, porque significa que alguien
        # cambió `proyeccion.aplicar` sin mirar esto.
        log.error(
            "la proyección cambió pero no se encuentra la suscripción %s de %s",
            datos.get("suscripcion_id"), sobre["organizacion_id"],
        )
        return True

    resultado = anulacion.revisar(suscripcion, evento_id=sobre["id"])
    if resultado:
        log.info(
            "evento %s: %d alerta(s) anulada(s), %d corregida(s)",
            sobre["id"], len(resultado.anuladas), len(resultado.corregidas),
        )
    return True

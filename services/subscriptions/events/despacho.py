"""El interruptor entre los dos modos. Es lo único que cambia la bandera.

    EVENTOS_ASINCRONOS=0  → el trabajo derivado se hace DENTRO del POST.
                            El usuario espera a que termine.
    EVENTOS_ASINCRONOS=1  → se publica el evento y el POST responde al tiro.
                            El trabajo lo hace el consumidor, detrás de la cola.

En los dos casos se ejecuta exactamente el mismo `recalcular_resumen`. Lo que
cambia es *quién espera*, que es precisamente lo que mide la comparación.

── Qué pasa si RabbitMQ está caído ──────────────────────────────────────────
Se registra el error y la petición responde igual. Crear la suscripción es lo
que el usuario pidió; el resumen es trabajo derivado y puede recalcularse
después. Tumbar el POST porque el broker no está sería el acoplamiento que el
ADR-003 quiere evitar.

Esto deja una ventana real: si el publicar falla, ese evento se pierde y el
resumen queda viejo hasta el próximo. La solución correcta es un *outbox*
(guardar el evento en la misma transacción que la suscripción y despacharlo
aparte), y no está hecha. Queda anotado, no escondido.
"""

import logging

from django.conf import settings

from events.publicador import publicar
from events.trabajo import recalcular_resumen

registro = logging.getLogger(__name__)

EVENTO_SUSCRIPCION_CREADA = "suscripcion.creada"


def al_crear_suscripcion(suscripcion, correlation_id: str = "") -> str:
    """Devuelve el modo en que se despachó: "sincrono" o "asincrono"."""
    if not settings.EVENTOS_ASINCRONOS:
        recalcular_resumen(suscripcion.organizacion_id)
        return "sincrono"

    # Los cinco campos que el catálogo declara para `suscripcion.creada`, ni
    # uno menos. Faltaba `proveedor_id`: el consumidor que lo espere recibía un
    # evento incompleto sin que nada avisara, porque nadie valida el payload
    # contra el contrato todavía. Va null cuando la suscripción no tiene
    # proveedor asociado, que es un caso legítimo.
    datos = {
        "suscripcion_id": str(suscripcion.id),
        "proveedor_id": (
            str(suscripcion.proveedor_id) if suscripcion.proveedor_id else None
        ),
        "monto": str(suscripcion.monto),
        "ciclo": suscripcion.frecuencia,
        "proximo_cobro": (
            suscripcion.fecha_proximo_cobro.isoformat()
            if suscripcion.fecha_proximo_cobro
            else None
        ),
    }
    try:
        publicar(
            EVENTO_SUSCRIPCION_CREADA,
            datos,
            suscripcion.organizacion_id,
            correlation_id,
        )
    except Exception:
        registro.exception(
            "No se pudo publicar %s para la suscripción %s; el resumen queda viejo",
            EVENTO_SUSCRIPCION_CREADA,
            suscripcion.id,
        )
    return "asincrono"

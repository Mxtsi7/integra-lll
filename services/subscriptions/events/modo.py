"""El interruptor entre los dos modos. Es lo único que mira la bandera.

    EVENTOS_ASINCRONOS=0  → el trabajo derivado se hace DENTRO del POST.
                            El usuario espera a que termine.
    EVENTOS_ASINCRONOS=1  → el POST solo deja el evento en el outbox y
                            responde. El trabajo lo hace el consumidor,
                            detrás de la cola.

En los dos casos se ejecuta exactamente el mismo `recalcular_resumen`. Lo que
cambia es *quién espera*, que es precisamente lo que mide la comparación
(k8s/pruebas/comparar-cola.sh).

── La bandera NO apaga el outbox ────────────────────────────────────────────
`perform_create` registra `suscripcion.creada` en el outbox en los dos modos,
porque el evento es parte del contrato (MX-21) y puede haber otros
consumidores. Lo único que decide esta bandera es si ADEMÁS se recalcula el
resumen antes de responder.

── Qué pasa si RabbitMQ está caído ──────────────────────────────────────────
Nada se pierde, y eso es mérito del outbox de MX-21/VI-26, no de este
archivo. El evento se guarda en `OutboxEvento` dentro de la misma transacción
que la suscripción, y lo despacha aparte `events/despacho.py` con reintentos.
Si el broker no está, el registro queda pendiente y se publica cuando vuelva.

(La versión anterior de este archivo publicaba directo a RabbitMQ y dejaba una
ventana real: si el publicar fallaba, el evento se perdía y el resumen quedaba
viejo. Eso quedaba anotado como deuda. El outbox la pagó.)
"""

import logging

from django.conf import settings

from events.trabajo import recalcular_resumen


registro = logging.getLogger(__name__)


def al_crear_suscripcion(suscripcion) -> str:
    """Hace el trabajo derivado si toca. Devuelve "sincrono" o "asincrono".

    El valor de retorno es para la prueba de comparación: deja constancia en
    la respuesta de por qué camino se fue, así la medición no depende de
    recordar cómo quedó la variable de entorno.
    """
    if settings.EVENTOS_ASINCRONOS:
        # El evento ya está en el outbox. El consumidor
        # (`manage.py consumir_eventos`) recalcula cuando lo reciba.
        return "asincrono"

    recalcular_resumen(suscripcion.organizacion_id)
    # Se cuenta igual que en el consumidor, con el mismo formato, para poder
    # comprobar al comparar que los dos modos hicieron la MISMA cantidad de
    # trabajo. comparar-cola.sh cuenta estas líneas en los dos lados.
    registro.info(
        "resumen.recalculado modo=sincrono org=%s", suscripcion.organizacion_id
    )
    return "sincrono"

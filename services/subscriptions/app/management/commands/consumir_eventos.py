"""Consume los eventos de dominio desde RabbitMQ y hace el trabajo derivado.

    python manage.py consumir_eventos

Corre como un proceso aparte, al lado del worker de Celery. No atiende
tráfico HTTP: se queda escuchando la cola y procesando lo que llega.

── Idempotencia ─────────────────────────────────────────────────────────────
El catálogo (regla 1) exige que los consumidores lo sean, porque RabbitMQ
garantiza *al menos una* entrega. Acá sale gratis: `recalcular_resumen` lee el
estado actual de la base y hace `update_or_create`. Procesar el mismo evento
dos veces deja exactamente el mismo resultado, así que no hace falta guardar
los ids ya vistos.

── Por qué prefetch_count=1 ─────────────────────────────────────────────────
Sin eso RabbitMQ le manda al consumidor todos los mensajes de una, y se
pierde la razón de tener cola: que el trabajo se drene a ritmo parejo. Con 1,
no recibe el siguiente hasta confirmar el anterior.

── Los tres desenlaces de un mensaje ────────────────────────────────────────
La versión anterior tenía dos y los dos estaban mal:

    ilegible        → se hacía ACK, o sea se BORRABA sin dejar rastro
    cualquier fallo → nack(requeue=False) sin cola de fallos: también se
                      borraba, incluso por una desconexión pasajera de
                      Postgres, y el outbox ya lo había dado por publicado

Ahora son tres y ninguno pierde el mensaje:

    correcto    → ack
    pasajero    → se reintenta en el proceso, con espera creciente; si el
                  problema sigue, se manda a la cola de fallos
    definitivo  → derecho a la cola de fallos

"Definitivo" es un sobre que no va a mejorar por reintentarlo: no es un
objeto JSON, le falta la organización, el evento no es de los que escuchamos.
"Pasajero" es la base caída, que vuelve.
"""

import json
import logging
import signal
import time
import uuid

import pika
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError

from events.contrato import routing_key
from events.validacion import errores as errores_de_contrato
from events.topologia import (
    COLA_FALLIDOS,
    COLA_RESUMEN,
    EVENTOS_DEL_RESUMEN,
    EXCHANGE,
    declarar,
)
from events.trabajo import recalcular_resumen


registro = logging.getLogger(__name__)

#: Cuántas veces se reintenta en el proceso antes de rendirse y mandarlo a la
#: cola de fallos. Con 3 intentos hay DOS esperas —entre el 1.º y el 2.º, y
#: entre el 2.º y el 3.º—, así que suman 3 s (1+2), no 7. (La primera versión
#: de este comentario decía 1+2+4; lo corrigió la revisión de la PR.)
#:
#: Lo que importa del número: tiene que quedar bastante por debajo del
#: heartbeat de AMQP (60 s por omisión), o el broker daría la conexión por
#: muerta en medio del reintento. Si se suben los intentos, revisar la suma:
#: con 6 serían 31 s y ya queda cerca.
INTENTOS = 3
ESPERA_INICIAL = 1

#: Los errores que SÍ vale la pena reintentar. Son los de conexión a la base:
#: un `OperationalError` es Postgres caído o reiniciándose, y vuelve.
ERRORES_PASAJEROS = (OperationalError, InterfaceError)


class SobreInvalido(ValueError):
    """El mensaje no cumple el contrato. Reintentarlo no lo va a arreglar."""


def validar(cuerpo: bytes) -> str:
    """Comprueba el sobre y devuelve la organización. Lanza `SobreInvalido`.

    Se valida ANTES de tocar la base, en tres pasos:

    1. **Que sea JSON.** Antes se leía `sobre["organizacion_id"]` capturando
       `ValueError/KeyError`, así que un cuerpo `[]` reventaba con
       `TypeError` —"list indices must be integers"— sin capturar, y el
       consumidor se moría. Cualquier JSON que no fuera un objeto lo mataba.

    2. **Que cumpla el contrato MX-21 v2 completo**, contra el mismo archivo
       que usa el check `intercambio` de la CI. La versión anterior solo
       miraba evento, versión y tenant, así que un sobre de esos tres campos
       pasaba y recibía ACK sin `id`, `correlation_id`, `ocurrido_en` ni
       `datos`. Lo reprodujo la revisión de la PR.

    3. **Que sea uno de los eventos de ESTA cola.** El esquema admite los
       cuatro del contrato; acá solo se procesan los de `EVENTOS_DEL_RESUMEN`.
       Que llegue otro no es culpa del productor: es un enlace de más de
       nuestro lado, y por eso se aparta en vez de ignorarse en silencio.
    """
    try:
        sobre = json.loads(cuerpo)
    except ValueError as exc:
        raise SobreInvalido(f"no es JSON: {exc}") from exc

    fallos = errores_de_contrato(sobre)
    if fallos:
        raise SobreInvalido("no cumple el contrato MX-21 v2 — " + "; ".join(fallos[:5]))

    nombre, version = sobre.get("evento"), sobre.get("version")
    if (nombre, version) not in EVENTOS_DEL_RESUMEN:
        raise SobreInvalido(f"evento no admitido en esta cola: {nombre!r} v{version!r}")

    # El esquema ya comprobó que sea un UUID; se devuelve normalizado.
    return str(uuid.UUID(str(sobre["organizacion_id"])))


class Command(BaseCommand):
    help = "Escucha los eventos de dominio en RabbitMQ y recalcula el resumen."

    def add_arguments(self, parser):
        parser.add_argument(
            "--uno",
            action="store_true",
            help="Procesa un solo mensaje y termina. Para probar sin colgarse.",
        )

    def handle(self, *args, **opciones):
        conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
        canal = conexion.channel()
        # La misma topología que declara el publicador (events/topologia.py).
        declarar(canal)
        canal.basic_qos(prefetch_count=1)

        def apagar(*_):
            self.stdout.write("apagando el consumidor")
            canal.stop_consuming()

        signal.signal(signal.SIGTERM, apagar)
        signal.signal(signal.SIGINT, apagar)

        def a_la_cola_de_fallos(canal_, metodo, motivo: str, cuerpo: bytes):
            """Rechaza sin reencolar: la cola tiene DLX, así que el mensaje se
            va a `COLA_FALLIDOS` en vez de borrarse."""
            self.stderr.write(f"a {COLA_FALLIDOS}: {motivo} | {cuerpo[:200]!r}")
            registro.warning("evento apartado (%s): %r", motivo, cuerpo[:500])
            canal_.basic_reject(delivery_tag=metodo.delivery_tag, requeue=False)

        def al_recibir(canal_, metodo, _propiedades, cuerpo):
            # Django cierra las conexiones a la base por petición HTTP; acá no
            # hay peticiones, así que hay que limpiarlas a mano o se quedan
            # conexiones muertas después de un corte.
            close_old_connections()

            try:
                organizacion_id = validar(cuerpo)
            except SobreInvalido as error:
                a_la_cola_de_fallos(canal_, metodo, str(error), cuerpo)
                return self._quizas_parar(canal_, opciones)

            # ── En modo síncrono el POST ya hizo este trabajo ───────────────
            # Con EVENTOS_ASINCRONOS=0 el recálculo ocurre dentro del POST, y
            # el evento igual se registra en el outbox porque es parte del
            # contrato y puede haber otros consumidores. Pero ESTE consumidor
            # recalcularía lo mismo una segunda vez.
            #
            # Eso rompía la comparación: el modo 0 hacía el doble de trabajo
            # que el modo 1, así que los números no medían arquitectura.
            # Lo encontró la revisión de la PR.
            #
            # Se confirma el mensaje igual: el trabajo está hecho, no pendiente.
            if not settings.EVENTOS_ASINCRONOS:
                registro.info(
                    "resumen.omitido modo=sincrono org=%s "
                    "(el POST ya recalculó; el evento se confirma)",
                    organizacion_id,
                )
                canal_.basic_ack(delivery_tag=metodo.delivery_tag)
                return self._quizas_parar(canal_, opciones)

            ultimo = None
            espera = ESPERA_INICIAL
            for intento in range(1, INTENTOS + 1):
                try:
                    recalcular_resumen(organizacion_id)
                except ERRORES_PASAJEROS as error:
                    ultimo = error
                    if intento < INTENTOS:
                        self.stderr.write(
                            f"base no disponible (intento {intento}/{INTENTOS}), "
                            f"reintento en {espera}s: {error}"
                        )
                        time.sleep(espera)
                        espera *= 2
                        # La conexión quedó rota: hay que soltarla o el
                        # reintento la vuelve a usar y falla igual.
                        close_old_connections()
                        continue
                except Exception as error:  # noqa: BLE001
                    # Un fallo que no es de conexión no mejora reintentando.
                    a_la_cola_de_fallos(
                        canal_, metodo, f"error al recalcular: {error}", cuerpo
                    )
                    return self._quizas_parar(canal_, opciones)
                else:
                    # Se cuenta en el log para poder comprobar, al comparar,
                    # que cada modo hizo la MISMA cantidad de trabajo.
                    # comparar-cola.sh cuenta estas líneas.
                    registro.info(
                        "resumen.recalculado modo=asincrono org=%s", organizacion_id
                    )
                    canal_.basic_ack(delivery_tag=metodo.delivery_tag)
                    return self._quizas_parar(canal_, opciones)

            a_la_cola_de_fallos(
                canal_, metodo, f"base no disponible tras {INTENTOS} intentos: {ultimo}", cuerpo
            )
            return self._quizas_parar(canal_, opciones)

        canal.basic_consume(queue=COLA_RESUMEN, on_message_callback=al_recibir)
        self.stdout.write(
            f"escuchando {COLA_RESUMEN} en {EXCHANGE} "
            f"({', '.join(routing_key(_Clave(n, v)) for n, v in EVENTOS_DEL_RESUMEN)}); "
            f"los fallos van a {COLA_FALLIDOS}"
        )
        canal.start_consuming()
        conexion.close()

    @staticmethod
    def _quizas_parar(canal, opciones) -> None:
        """Con --uno se corta después del primer mensaje, sea cual sea el
        desenlace. Si solo cortara al tener éxito, una prueba de un mensaje
        inválido se quedaría colgada esperando para siempre."""
        if opciones["uno"]:
            canal.stop_consuming()


class _Clave:
    """Lo mínimo para preguntarle la routing key al contrato, para el log."""

    def __init__(self, evento: str, version: int):
        self.evento = evento
        self.version = version

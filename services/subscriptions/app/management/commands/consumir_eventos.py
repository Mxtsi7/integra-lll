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
#: cola de fallos. Las esperas suman 7 s (1+2+4), bastante menos que el
#: heartbeat de AMQP (60 s por omisión): esperar más haría que el broker diera
#: la conexión por muerta en medio del reintento.
INTENTOS = 3
ESPERA_INICIAL = 1

#: Los errores que SÍ vale la pena reintentar. Son los de conexión a la base:
#: un `OperationalError` es Postgres caído o reiniciándose, y vuelve.
ERRORES_PASAJEROS = (OperationalError, InterfaceError)


class SobreInvalido(ValueError):
    """El mensaje no cumple el contrato. Reintentarlo no lo va a arreglar."""


def validar(cuerpo: bytes) -> str:
    """Comprueba el sobre y devuelve la organización. Lanza `SobreInvalido`.

    Se valida ANTES de tocar la base. La versión anterior leía
    `sobre["organizacion_id"]` y capturaba `ValueError/KeyError`, así que un
    cuerpo `[]` reventaba con `TypeError` —"list indices must be integers"—
    sin capturar, y el consumidor se moría. Cualquier JSON que no fuera un
    objeto lo mataba igual.

    Y un objeto con tenant válido pero `evento="no.admitido"` pasaba derecho
    al recálculo y recibía ACK: no se miraba el contrato.
    """
    try:
        sobre = json.loads(cuerpo)
    except ValueError as exc:
        raise SobreInvalido(f"no es JSON: {exc}") from exc

    if not isinstance(sobre, dict):
        raise SobreInvalido(f"el sobre no es un objeto JSON, es {type(sobre).__name__}")

    nombre = sobre.get("evento")
    version = sobre.get("version")
    if (nombre, version) not in EVENTOS_DEL_RESUMEN:
        # No es un error del otro lado: esta cola no debería recibirlo. Se
        # aparta para poder ver POR QUÉ llegó, que suele ser un enlace de más.
        raise SobreInvalido(f"evento no admitido en esta cola: {nombre!r} v{version!r}")

    crudo = sobre.get("organizacion_id")
    try:
        # Regla 4 del catálogo: el contexto multi-tenant viaja en el evento.
        # Se valida que sea un UUID; recalcular la organización equivocada
        # sería peor que apartar el mensaje.
        return str(uuid.UUID(str(crudo)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise SobreInvalido(f"organizacion_id no es un UUID: {crudo!r}") from exc


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

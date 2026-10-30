"""Consume los eventos de dominio desde RabbitMQ y hace el trabajo derivado.

    python manage.py consumir_eventos

Corre como un proceso aparte, al lado del worker de Celery. No atiende
tráfico HTTP: se queda escuchando la cola y procesando lo que llega.

── Idempotencia ─────────────────────────────────────────────────────────────
El catálogo (regla 1) exige que los consumidores lo sean, porque RabbitMQ
garantiza *al menos una* entrega. `recalcular_resumen` ya lo es por
construcción (lee el estado actual y hace `update_or_create`), y además cada
evento deja EVIDENCIA de que su trabajo se hizo (`TrabajoDerivado`): una
reentrega la encuentra y confirma sin repetir.

── Por qué prefetch_count=1 ─────────────────────────────────────────────────
Sin eso RabbitMQ le manda al consumidor todos los mensajes de una, y se
pierde la razón de tener cola: que el trabajo se drene a ritmo parejo. Con 1,
no recibe el siguiente hasta confirmar el anterior.

── Los cuatro desenlaces de un mensaje ──────────────────────────────────────
La versión anterior tenía dos y los dos estaban mal:

    ilegible        → se hacía ACK, o sea se BORRABA sin dejar rastro
    cualquier fallo → nack(requeue=False) sin cola de fallos: también se
                      borraba, incluso por una desconexión pasajera de
                      Postgres, y el outbox ya lo había dado por publicado

Ahora son cuatro y ninguno pierde un mensaje que todavía tenga trabajo:

    correcto    → ack, y SOLO después de que el trabajo quedó confirmado
                  en la base (o de encontrar la evidencia de que ya estaba)
    obsoleto    → ack sin trabajo ni evidencia: la organización ya fue
                  eliminada (su marca durable de MX-07) y no queda resumen
                  que recalcular
    pasajero    → se reintenta en el proceso, con espera creciente; si el
                  problema sigue, se manda a la cola de fallos
    definitivo  → derecho a la cola de fallos

"Definitivo" es un sobre que no va a mejorar por reintentarlo: no es un
objeto JSON, le falta la organización, el evento no es de los que escuchamos.
"Pasajero" es la base caída, que vuelve.

── El consumidor NO mira la bandera ─────────────────────────────────────────
La versión anterior confirmaba sin recalcular cuando SU `EVENTOS_ASINCRONOS`
estaba en 0, dando por hecho que el POST ya había recalculado. Pero la
bandera del proceso que consume no dice nada de lo que hizo el que produjo:
un evento producido en asíncrono (sin resumen) y consumido con la bandera en
0 recibía ACK y el resumen no existía nunca. Pasa al cambiar de modo con
mensajes pendientes, o con API y worker configurados distinto durante un
despliegue. Lo reprodujo la revisión de la PR.

Ahora la decisión sale de la evidencia durable vinculada al evento: si el
POST acreditó el trabajo de ESTE evento, se omite; si no, se hace. Sea cual
sea la bandera de este proceso. Ver `events/trabajo.py`.
"""

import json
import logging
import signal
import time
import uuid
from dataclasses import dataclass

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
from events.trabajo import (
    HECHO_POR_CONSUMIDOR, OrganizacionEliminada, recalcular_resumen_por_evento,
)


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


def leer_sobre(cuerpo: bytes) -> tuple[str, str]:
    """Comprueba el sobre y devuelve `(evento_id, organizacion_id)`.

    Lanza `SobreInvalido`. Se valida ANTES de tocar la base, en tres pasos:

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

    # El esquema ya comprobó que sean UUID; se devuelven normalizados.
    return (
        str(uuid.UUID(str(sobre["id"]))),
        str(uuid.UUID(str(sobre["organizacion_id"]))),
    )


def validar(cuerpo: bytes) -> str:
    """Comprueba el sobre y devuelve la organización. Lanza `SobreInvalido`."""
    return leer_sobre(cuerpo)[1]


@dataclass(frozen=True)
class Desenlace:
    """Qué hacer con el mensaje después de procesarlo."""

    #: True → ack. False → a la cola de fallos, con el motivo.
    confirmar: bool
    motivo: str = ""
    #: True si ESTE proceso recalculó; False si estaba acreditado u obsoleto.
    recalculado: bool = False


def procesar(cuerpo: bytes, *, dormir=time.sleep, avisar=None) -> Desenlace:
    """Hace el trabajo de un mensaje y dice si se confirma o se aparta.

    No toca el canal: devolver el desenlace y que el llamador haga el ack es
    lo que garantiza que el ack venga SIEMPRE después de que el trabajo quedó
    confirmado en la base, o de comprobar bajo el bloqueo que la organización
    fue eliminada y el evento quedó obsoleto. Y permite probarlo sin broker.
    """
    avisar = avisar or (lambda _texto: None)
    try:
        evento_id, organizacion_id = leer_sobre(cuerpo)
    except SobreInvalido as error:
        return Desenlace(confirmar=False, motivo=str(error))

    ultimo = None
    espera = ESPERA_INICIAL
    for intento in range(1, INTENTOS + 1):
        try:
            hecho = recalcular_resumen_por_evento(
                evento_id, organizacion_id, hecho_por=HECHO_POR_CONSUMIDOR
            )
        except OrganizacionEliminada:
            # El tombstone durable vuelve obsoleta la entrega. No es trabajo hecho.
            registro.info(
                "resumen.omitido organizacion_eliminada org=%s evento=%s",
                organizacion_id, evento_id,
            )
            return Desenlace(confirmar=True, motivo="organizacion_eliminada")
        except ERRORES_PASAJEROS as error:
            ultimo = error
            if intento < INTENTOS:
                avisar(
                    f"base no disponible (intento {intento}/{INTENTOS}), "
                    f"reintento en {espera}s: {error}"
                )
                dormir(espera)
                espera *= 2
                # La conexión quedó rota: hay que soltarla o el reintento la
                # vuelve a usar y falla igual.
                close_old_connections()
                continue
        except Exception as error:  # noqa: BLE001
            # Un fallo que no es de conexión no mejora reintentando.
            return Desenlace(confirmar=False, motivo=f"error al recalcular: {error}")
        else:
            if hecho:
                # Se cuenta en el log para poder comprobar, al comparar, que
                # cada modo hizo la MISMA cantidad de trabajo.
                # comparar-cola.sh cuenta estas líneas.
                registro.info(
                    "resumen.recalculado modo=asincrono org=%s evento=%s",
                    organizacion_id, evento_id,
                )
            else:
                # Ya estaba acreditado: lo hizo el POST (modo síncrono) o es
                # una reentrega. Se confirma porque el trabajo ESTÁ hecho, y
                # eso lo dice la evidencia, no la bandera de este proceso.
                registro.info(
                    "resumen.omitido ya_acreditado org=%s evento=%s",
                    organizacion_id, evento_id,
                )
            return Desenlace(confirmar=True, recalculado=hecho)

    return Desenlace(
        confirmar=False,
        motivo=f"base no disponible tras {INTENTOS} intentos: {ultimo}",
    )


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

        def al_recibir(canal_, metodo, _propiedades, cuerpo):
            self.atender(canal_, metodo, cuerpo)
            if opciones["uno"]:
                # Con --uno se corta después del primer mensaje, sea cual sea
                # el desenlace. Si solo cortara al tener éxito, una prueba de
                # un mensaje inválido se quedaría colgada para siempre.
                canal_.stop_consuming()

        canal.basic_consume(queue=COLA_RESUMEN, on_message_callback=al_recibir)
        self.stdout.write(
            f"escuchando {COLA_RESUMEN} en {EXCHANGE} "
            f"({', '.join(routing_key(_Clave(n, v)) for n, v in EVENTOS_DEL_RESUMEN)}); "
            f"los fallos van a {COLA_FALLIDOS}"
        )
        canal.start_consuming()
        conexion.close()

    def atender(self, canal_, metodo, cuerpo) -> Desenlace:
        """Procesa UN mensaje y lo confirma o lo aparta. Devuelve el desenlace.

        El ack va después de `procesar`, nunca antes: `procesar` solo devuelve
        `confirmar=True` cuando el trabajo quedó confirmado en la base, cuando
        encontró la evidencia de que ya estaba o cuando la organización ya fue
        eliminada y el evento quedó obsoleto. Si se cae entre medio, el
        mensaje sigue sin confirmar y RabbitMQ lo vuelve a entregar.
        """
        # Django cierra las conexiones a la base por petición HTTP; acá no
        # hay peticiones, así que hay que limpiarlas a mano o se quedan
        # conexiones muertas después de un corte.
        close_old_connections()

        desenlace = procesar(cuerpo, avisar=self.stderr.write)
        if desenlace.confirmar:
            canal_.basic_ack(delivery_tag=metodo.delivery_tag)
        else:
            # Rechaza sin reencolar: la cola tiene DLX, así que el mensaje se
            # va a `COLA_FALLIDOS` en vez de borrarse.
            self.stderr.write(f"a {COLA_FALLIDOS}: {desenlace.motivo} | {cuerpo[:200]!r}")
            registro.warning("evento apartado (%s): %r", desenlace.motivo, cuerpo[:500])
            canal_.basic_reject(delivery_tag=metodo.delivery_tag, requeue=False)
        return desenlace


class _Clave:
    """Lo mínimo para preguntarle la routing key al contrato, para el log."""

    def __init__(self, evento: str, version: int):
        self.evento = evento
        self.version = version

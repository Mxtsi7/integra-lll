"""Consume los eventos de dominio y mantiene la proyección (FE-24).

    python manage.py consumir_eventos

Corre como un proceso aparte del servidor HTTP: se queda escuchando
`notifications.dominio.v2` y procesando lo que llega. Es el único camino por
el que Notifications se entera de que existe una suscripción, porque no
consulta el esquema de Subscriptions (ADR-002).

── Los tres desenlaces de un mensaje ───────────────────────────────────────
    correcto    → ack, y SOLO después de que la transacción (inbox + efecto)
                  quedó confirmada en la base
    pasajero    → se reintenta en el proceso, con espera creciente; si el
                  problema sigue, a la cola de fallos
    definitivo  → derecho a la cola de fallos

"Definitivo" es un sobre que no va a mejorar por reintentarlo: no es JSON, no
cumple el contrato, o es un evento que esta cola no debería estar recibiendo
(un enlace de más de nuestro lado). "Pasajero" es la base caída, que vuelve.

Ninguno descarta el mensaje: las dos colas tienen `x-dead-letter-exchange`,
así que un `reject(requeue=False)` lo manda a `notifications.fallidos` y queda
ahí para mirarlo y reprocesarlo después de corregir la causa.

── Por qué prefetch_count=1 ────────────────────────────────────────────────
Sin eso RabbitMQ le manda todos los mensajes de una y se pierde la razón de
tener cola: que el trabajo se drene a ritmo parejo. Con 1, no recibe el
siguiente hasta confirmar el anterior.
"""

import json
import logging
import signal
import time
from dataclasses import dataclass

import pika
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError

from events import dominio
from events.entrada import recibir
from events.topologia import (
    COLA_DOMINIO,
    COLA_FALLIDOS,
    EVENTOS_DE_DOMINIO,
    EXCHANGE,
    PATRONES_DOMINIO,
    declarar,
)
from shared.events.validacion import errores as errores_de_contrato

registro = logging.getLogger(__name__)

#: Cuántas veces se reintenta en el proceso antes de rendirse. Con 3 intentos
#: hay DOS esperas —entre el 1.º y el 2.º, y entre el 2.º y el 3.º—, así que
#: suman 3 s (1+2), no 7.
#:
#: Lo que importa del número: tiene que quedar bastante por debajo del
#: heartbeat de AMQP (60 s por omisión), o el broker daría la conexión por
#: muerta en medio del reintento. Con 6 intentos serían 31 s y ya queda cerca.
INTENTOS = 3
ESPERA_INICIAL = 1

#: Los errores que SÍ vale la pena reintentar: los de conexión a la base. Un
#: `OperationalError` es Postgres caído o reiniciándose, y vuelve.
ERRORES_PASAJEROS = (OperationalError, InterfaceError)

#: Los nombres de evento admitidos en esta cola, para comprobarlo rápido.
ADMITIDOS = frozenset(EVENTOS_DE_DOMINIO)


class SobreInvalido(ValueError):
    """El mensaje no cumple el contrato. Reintentarlo no lo va a arreglar."""


def leer_sobre(cuerpo: bytes) -> dict:
    """Comprueba el sobre y lo devuelve. Lanza `SobreInvalido`.

    Se valida ANTES de tocar la base, en tres pasos:

    1. **Que sea JSON.** Y que sea un objeto: leer `sobre["id"]` de un cuerpo
       `[]` revienta con `TypeError` ("list indices must be integers"), que no
       es un `ValueError` y mataría el consumidor.

    2. **Que cumpla el contrato MX-21 v2 completo**, contra el mismo archivo
       que usa el check `intercambio` de la CI. No alcanza con mirar evento,
       versión y tenant: un sobre de esos tres campos pasaría sin `id`, y el
       `id` es justamente lo que el inbox necesita para deduplicar.

    3. **Que sea uno de los eventos de ESTA cola.** El esquema admite los
       cuatro del contrato; acá solo van los tres de suscripción. Que llegue
       `alerta.activada` no es culpa del productor: es un enlace de más de
       nuestro lado, y por eso se aparta en vez de ignorarse en silencio.
       Ignorarlo con un ack escondería el lazo de realimentación que la
       separación de colas existe para evitar.
    """
    try:
        sobre = json.loads(cuerpo)
    except ValueError as exc:
        raise SobreInvalido(f"no es JSON: {exc}") from exc

    fallos = errores_de_contrato(sobre)
    if fallos:
        raise SobreInvalido("no cumple el contrato MX-21 v2 — " + "; ".join(fallos[:5]))

    clave = (sobre.get("evento"), sobre.get("version"))
    if clave not in ADMITIDOS:
        raise SobreInvalido(
            f"evento no admitido en {COLA_DOMINIO}: {clave[0]!r} v{clave[1]!r}"
        )
    return sobre


@dataclass(frozen=True)
class Desenlace:
    """Qué hacer con el mensaje después de procesarlo."""

    #: True → ack. False → a la cola de fallos, con el motivo.
    confirmar: bool
    motivo: str = ""
    #: True si ESTE mensaje cambió algo.
    efecto: bool = False
    #: True si se descartó por estar ya en el inbox.
    duplicado: bool = False


def procesar(cuerpo: bytes, *, dormir=time.sleep, avisar=None) -> Desenlace:
    """Hace el trabajo de un mensaje y dice si se confirma o se aparta.

    No toca el canal: devolver el desenlace y que el llamador haga el ack es
    lo que garantiza que el ack venga SIEMPRE después del commit. Y permite
    probar todo el camino sin levantar el broker.
    """
    avisar = avisar or (lambda _texto: None)
    try:
        sobre = leer_sobre(cuerpo)
    except SobreInvalido as error:
        return Desenlace(confirmar=False, motivo=str(error))

    ultimo = None
    espera = ESPERA_INICIAL
    for intento in range(1, INTENTOS + 1):
        try:
            recepcion = recibir(sobre, consumidor=COLA_DOMINIO, hacer=dominio.aplicar)
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
            # Un fallo que no es de conexión no mejora reintentando. Pasa con
            # un sobre que cumple el esquema pero que la proyección rechaza
            # por coherencia (un ciclo que no es mensual ni anual).
            return Desenlace(confirmar=False, motivo=f"{type(error).__name__}: {error}")
        else:
            registro.info(
                "evento %s procesado: efecto=%s duplicado=%s",
                sobre["id"], recepcion.efecto, recepcion.duplicado,
            )
            return Desenlace(
                confirmar=True,
                efecto=recepcion.efecto,
                duplicado=recepcion.duplicado,
            )

    return Desenlace(
        confirmar=False,
        motivo=f"base no disponible tras {INTENTOS} intentos: {ultimo}",
    )


class Command(BaseCommand):
    help = "Escucha los eventos de suscripción y mantiene la proyección y las alertas."

    def add_arguments(self, parser):
        parser.add_argument(
            "--uno",
            action="store_true",
            help="Procesa un solo mensaje y termina. Para probar sin colgarse.",
        )

    def handle(self, *args, **opciones):
        conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
        canal = conexion.channel()
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
                # Se corta después del primer mensaje sea cual sea el
                # desenlace. Si solo cortara al tener éxito, una prueba con un
                # mensaje inválido se quedaría colgada para siempre.
                canal_.stop_consuming()

        canal.basic_consume(queue=COLA_DOMINIO, on_message_callback=al_recibir)
        self.stdout.write(
            f"escuchando {COLA_DOMINIO} en {EXCHANGE} "
            f"({', '.join(PATRONES_DOMINIO)}); los fallos van a {COLA_FALLIDOS}"
        )
        canal.start_consuming()
        conexion.close()

    def atender(self, canal_, metodo, cuerpo) -> Desenlace:
        """Procesa UN mensaje y lo confirma o lo aparta.

        El ack va después de `procesar`, nunca antes: `procesar` solo devuelve
        `confirmar=True` cuando la transacción del inbox quedó confirmada. Si
        el proceso se cae entre medio, el mensaje sigue sin confirmar y
        RabbitMQ lo vuelve a entregar; el inbox lo descarta sin repetir.
        """
        # Django cierra las conexiones a la base por petición HTTP; acá no hay
        # peticiones, así que hay que limpiarlas a mano o quedan conexiones
        # muertas después de un corte.
        close_old_connections()

        desenlace = procesar(cuerpo, avisar=self.stderr.write)
        if desenlace.confirmar:
            canal_.basic_ack(delivery_tag=metodo.delivery_tag)
        else:
            self.stderr.write(
                f"a {COLA_FALLIDOS}: {desenlace.motivo} | {cuerpo[:200]!r}"
            )
            registro.warning("evento apartado (%s): %r", desenlace.motivo, cuerpo[:500])
            canal_.basic_reject(delivery_tag=metodo.delivery_tag, requeue=False)
        return desenlace

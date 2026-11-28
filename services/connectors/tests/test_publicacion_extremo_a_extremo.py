"""La orden de cobro contra un RabbitMQ de verdad: de la confirmación a la cola.

    confirmar → outbox → despachar → exchange `connectors.eventos` → `subscriptions.candidatos`

Los dobles de `test_publicacion_rf14.py` no ven que la clave publicada no
calce con el enlace de la cola: eso ya pasó en este repo con
`suscripcion.creada` y ninguna prueba con dobles lo encontró. Acá el broker
decide. Del otro lado, `services/subscriptions/tests/test_ordenes_de_cobro_extremo_a_extremo.py`
toma un mensaje de esa misma cola y lo aplica.

Sin broker se SALTA:

    docker run -d --name rabbit-prueba -p 5673:5672 rabbitmq:3.13-alpine
    RABBITMQ_PRUEBA_URL=amqp://guest:guest@127.0.0.1:5673/ pytest tests/test_publicacion_extremo_a_extremo.py

La CI lo levanta para connectors (`.github/workflows/ci.yml`).
"""

from __future__ import annotations

import json
import os
import time

import pytest

pika = pytest.importorskip("pika")

from connectors import confirmacion, publicacion  # noqa: E402
from connectors.models import OutboxEvento  # noqa: E402
from shared.contratos import candidato_confirmado as contrato  # noqa: E402
from tests.test_confirmar_candidatos import crear_candidato  # noqa: E402

URL_PRUEBA = os.environ.get("RABBITMQ_PRUEBA_URL", "")

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(not URL_PRUEBA, reason="necesita un RabbitMQ real; definir RABBITMQ_PRUEBA_URL"),
]


@pytest.fixture
def canal(settings):
    """Un canal limpio: las colas se borran antes, por si una corrida anterior
    las dejó con otros argumentos (PRECONDITION_FAILED no explica nada)."""
    settings.RABBITMQ_URL = URL_PRUEBA
    conexion = pika.BlockingConnection(pika.URLParameters(URL_PRUEBA))
    ch = conexion.channel()
    for cola in (contrato.COLA, contrato.COLA_FALLIDOS):
        try:
            ch.queue_delete(queue=cola)
        except pika.exceptions.ChannelClosedByBroker:
            ch = conexion.channel()
    yield ch
    if conexion.is_open:
        conexion.close()


def recibir(canal, cola, *, intentos=25, pausa=0.2):
    for _ in range(intentos):
        metodo, propiedades, cuerpo = canal.basic_get(queue=cola, auto_ack=True)
        if metodo is not None:
            return metodo, propiedades, cuerpo
        time.sleep(pausa)
    return None, None, None


def test_la_orden_confirmada_llega_a_la_cola_de_subscriptions(canal):
    candidato = crear_candidato()
    confirmacion.confirmar(candidato, por="42")

    # La cola ni siquiera existe todavía: la declara el publicador. Es el caso
    # de connectors desplegado antes que el consumidor.
    assert publicacion.despachar_pendientes() == {"publicados": 1, "reintentados": 0, "sin_broker": 0}

    metodo, propiedades, cuerpo = recibir(canal, contrato.COLA)
    assert metodo is not None, "el mensaje no llegó a subscriptions.candidatos"
    assert metodo.routing_key == "candidato.confirmado.v1"
    assert propiedades.delivery_mode == 2
    sobre = json.loads(cuerpo)
    assert contrato.errores(sobre) == []
    assert sobre["datos"]["candidato_id"] == str(candidato.id)
    assert OutboxEvento.objects.get().publicado_en is not None


def test_otra_version_no_llega_a_la_cola(canal):
    """El enlace es la versión exacta: una v2 no se consume en silencio con
    el código de v1. Con `mandatory`, el broker la devuelve."""
    contrato.declarar(canal)
    canal.confirm_delivery()
    with pytest.raises(pika.exceptions.UnroutableError):
        canal.basic_publish(
            exchange=contrato.EXCHANGE, routing_key="candidato.confirmado.v2", body=b"{}", mandatory=True
        )
    assert recibir(canal, contrato.COLA, intentos=3)[0] is None

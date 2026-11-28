"""La orden de cobro contra un RabbitMQ de verdad, del lado que la aplica.

`services/connectors/tests/test_publicacion_extremo_a_extremo.py` comprueba
que la confirmación llega a `subscriptions.candidatos`. Esto toma un mensaje
de esa cola por el broker y hace lo que hace el consumidor: aplicarlo y
confirmarlo, o rechazarlo a la cola de fallos. Que el rechazo llegue a
`subscriptions.candidatos.fallidos` lo decide el `x-dead-letter-exchange` de
la cola, y eso solo lo prueba un broker.

Sin broker se SALTA (`RABBITMQ_PRUEBA_URL`, igual que el resto de las
pruebas de punta a punta de este servicio).
"""

from __future__ import annotations

import json
import os
import time
import uuid

import pytest

pika = pytest.importorskip("pika")

from app.management.commands import consumir_eventos  # noqa: E402
from app.management.commands.consumir_eventos import Command, procesar_candidato  # noqa: E402
from app.models import CandidatoAplicado, Cobro, Proveedor  # noqa: E402
from shared.contratos import candidato_confirmado as contrato  # noqa: E402
from shared.contratos import candidato_aplicado  # noqa: E402
from tests.test_ordenes_de_cobro_rf14 import sobre  # noqa: E402

URL_PRUEBA = os.environ.get("RABBITMQ_PRUEBA_URL", "")

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(not URL_PRUEBA, reason="necesita un RabbitMQ real; definir RABBITMQ_PRUEBA_URL"),
]


@pytest.fixture
def canal(monkeypatch):
    monkeypatch.setattr(consumir_eventos, "close_old_connections", lambda: None)
    conexion = pika.BlockingConnection(pika.URLParameters(URL_PRUEBA))
    ch = conexion.channel()
    for cola in (contrato.COLA, contrato.COLA_FALLIDOS):
        try:
            ch.queue_delete(queue=cola)
        except pika.exceptions.ChannelClosedByBroker:
            ch = conexion.channel()
    contrato.declarar(ch)
    ch.confirm_delivery()
    yield ch
    if conexion.is_open:
        conexion.close()


def publicar(canal, cuerpo: bytes):
    canal.basic_publish(
        exchange=contrato.EXCHANGE, routing_key=contrato.ROUTING_KEY, body=cuerpo, mandatory=True,
        properties=pika.BasicProperties(delivery_mode=pika.DeliveryMode.Persistent),
    )


def tomar(canal, cola, *, auto_ack=False, intentos=25, pausa=0.2):
    for _ in range(intentos):
        metodo, _props, cuerpo = canal.basic_get(queue=cola, auto_ack=auto_ack)
        if metodo is not None:
            return metodo, cuerpo
        time.sleep(pausa)
    return None, None


def test_una_orden_por_el_broker_queda_aplicada_y_confirmada(canal):
    org = uuid.uuid4()
    Proveedor.objects.get_or_create(nombre="Netflix", defaults={"categoria": "streaming"})
    publicar(canal, json.dumps(sobre(org)).encode())

    metodo, cuerpo = tomar(canal, contrato.COLA)
    assert metodo is not None
    desenlace = Command().atender(canal, metodo, cuerpo, procesador=procesar_candidato,
                                  cola_fallidos=contrato.COLA_FALLIDOS)
    assert desenlace.confirmar
    assert CandidatoAplicado.objects.filter(organizacion_id=org).count() == 1
    assert Cobro.objects.filter(organizacion_id=org).count() == 1
    # Con ack, no vuelve a la cola ni pasa a fallos.
    assert tomar(canal, contrato.COLA, auto_ack=True, intentos=3)[0] is None
    assert tomar(canal, contrato.COLA_FALLIDOS, auto_ack=True, intentos=3)[0] is None


def test_un_sobre_fuera_de_contrato_termina_en_la_cola_de_fallos(canal):
    org = uuid.uuid4()
    orden = sobre(org)
    orden["datos"]["importe"] = 9990  # número: el otro lado lo leería como float
    publicar(canal, json.dumps(orden).encode())

    metodo, cuerpo = tomar(canal, contrato.COLA)
    desenlace = Command().atender(canal, metodo, cuerpo, procesador=procesar_candidato,
                                  cola_fallidos=contrato.COLA_FALLIDOS)
    assert not desenlace.confirmar
    # El dead-lettering es asíncrono: se espera acotado, no un sleep fijo.
    apartado, cuerpo_apartado = tomar(canal, contrato.COLA_FALLIDOS, auto_ack=True)
    assert apartado is not None, "el rechazo no llegó a la cola de fallos"
    assert json.loads(cuerpo_apartado)["datos"]["importe"] == 9990
    assert not CandidatoAplicado.objects.filter(organizacion_id=org).exists()


def test_la_respuesta_sale_por_el_broker_a_la_cola_de_connectors(canal, settings):
    """La vuelta: `aplicar` deja `candidato.aplicado` en el outbox y el despacho
    de este servicio la publica donde connectors la va a buscar."""
    from events.despacho import despachar_pendientes

    candidato_aplicado.declarar(canal)
    for cola in (candidato_aplicado.COLA, candidato_aplicado.COLA_FALLIDOS):
        canal.queue_purge(queue=cola)
    settings.RABBITMQ_URL = URL_PRUEBA
    org = uuid.uuid4()
    Proveedor.objects.get_or_create(nombre="Netflix", defaults={"categoria": "streaming"})
    orden = sobre(org)
    publicar(canal, json.dumps(orden).encode())
    metodo, cuerpo = tomar(canal, contrato.COLA)
    Command().atender(canal, metodo, cuerpo, procesador=procesar_candidato, cola_fallidos=contrato.COLA_FALLIDOS)

    despachar_pendientes()

    metodo, cuerpo = tomar(canal, candidato_aplicado.COLA, auto_ack=True)
    assert metodo is not None, "la respuesta no llegó a connectors.candidatos.resultados"
    respuesta = json.loads(cuerpo)
    assert candidato_aplicado.errores(respuesta) == []
    assert respuesta["correlation_id"] == orden["correlation_id"]
    assert (respuesta["datos"]["orden_id"], respuesta["datos"]["resultado"]) == (orden["id"], "aplicado")

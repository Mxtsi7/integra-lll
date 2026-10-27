"""El recorrido completo contra un RabbitMQ de verdad.

    crear → outbox → publicar → enrutar a NUESTRA cola → recalcular

Existe por un bug que ninguna prueba con dobles podía ver: `topologia.py`
enlazaba la cola a `suscripcion.creada` mientras el publicador mandaba a
`suscripcion.creada.v2`. En un exchange topic ese enlace exacto no coincide
con esa clave, así que la publicación fallaba por no enrutable y el resumen
no llegaba nunca.

`TestTopologia` no lo vio porque comparaba la constante de `topologia` contra
el propio `topologia`: una prueba que se da la razón sola. Y la prueba de
equivalencia entre modos llamaba directo a `recalcular_resumen`, salteándose
la cola entera. Las dos pasaban con el enlace roto.

── Cómo correrla ────────────────────────────────────────────────────────────
Necesita un broker. Sin la variable de entorno se SALTA, para no romper la CI
de quien no lo tenga levantado:

    docker run -d --name rabbit-prueba -p 5673:5672 rabbitmq:3.13-alpine
    RABBITMQ_PRUEBA_URL=amqp://guest:guest@127.0.0.1:5673/ pytest tests/test_eventos_extremo_a_extremo.py

Que se salte sin broker es un riesgo asumido y hay que decirlo: en una CI sin
RabbitMQ, estas pruebas no corren y el bug volvería a pasar. Lo correcto es
levantar el servicio en el workflow; mientras no esté, correrla a mano antes
de tocar la topología.
"""

import json
import os
import time
import uuid
from datetime import date
from decimal import Decimal

import pytest

pika = pytest.importorskip("pika")

from app.models import ResumenOrganizacion, Subscription  # noqa: E402
from events import publicador, topologia  # noqa: E402
from events.contrato import routing_key  # noqa: E402
from events.outbox import registrar_creada  # noqa: E402
from events.trabajo import recalcular_resumen  # noqa: E402


URL_PRUEBA = os.environ.get("RABBITMQ_PRUEBA_URL", "")

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(
        not URL_PRUEBA,
        reason="necesita un RabbitMQ real; definir RABBITMQ_PRUEBA_URL",
    ),
]


@pytest.fixture
def canal(settings):
    """Un canal limpio contra el broker de prueba.

    Borra las colas antes de declararlas: si una corrida anterior las dejó con
    otros argumentos (por ejemplo sin el dead-letter exchange), declararlas de
    nuevo falla con PRECONDITION_FAILED y el error no dice nada útil.
    """
    settings.RABBITMQ_URL = URL_PRUEBA
    conexion = pika.BlockingConnection(pika.URLParameters(URL_PRUEBA))
    ch = conexion.channel()
    for cola in (topologia.COLA_RESUMEN, topologia.COLA_FALLIDOS):
        try:
            ch.queue_delete(queue=cola)
        except pika.exceptions.ChannelClosedByBroker:
            # No existía. El canal queda cerrado igual, hay que rehacerlo.
            ch = conexion.channel()
    topologia.declarar(ch)
    yield ch
    if conexion.is_open:
        conexion.close()


def esperar_mensaje(canal, cola, *, intentos=25, pausa=0.2):
    """`basic_get` con espera acotada. Devuelve el cuerpo o None.

    El dead-lettering de RabbitMQ es ASÍNCRONO: entre el reject y que el
    mensaje aparezca en la cola de fallos pasan unos 200 ms. Un
    `basic_get` inmediato devuelve None y parece que el mensaje se perdió.
    Lo comprobé contra el broker: llega en el primer reintento.

    Se espera un máximo acotado (5 s) en vez de un `sleep` fijo: con un
    sleep la prueba es lenta siempre y ADEMÁS intermitente si algún día
    tarda más.
    """
    for _ in range(intentos):
        metodo, _propiedades, cuerpo = canal.basic_get(queue=cola, auto_ack=True)
        if metodo is not None:
            return cuerpo
        time.sleep(pausa)
    return None


def una_suscripcion(org):
    return Subscription.objects.create(
        organizacion_id=org,
        nombre="Netflix",
        monto=Decimal("9990"),
        moneda="CLP",
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria="streaming",
        estado=Subscription.Estado.ACTIVO,
    )


class TestRecorridoCompleto:
    def test_la_clave_publicada_calza_con_el_enlace_de_la_cola(self, canal):
        """La regresión, en una línea.

        Con `mandatory=True` y confirms, publicar a una clave sin cola enlazada
        lanza `UnroutableError`. Si el enlace vuelve a quedar sin versión,
        esto falla acá mismo.
        """
        org = uuid.uuid4()
        evento = registrar_creada(una_suscripcion(org))
        assert routing_key(evento) == "suscripcion.creada.v2"

        # No debe lanzar. Antes lanzaba UnroutableError.
        publicador.publicar(evento)

    def test_el_mensaje_llega_a_NUESTRA_cola(self, canal):
        """Que la publicación no falle no alcanza: podría haberse enrutado a
        la cola de otro consumidor y el resumen igual no llegaría."""
        org = uuid.uuid4()
        evento = registrar_creada(una_suscripcion(org))
        publicador.publicar(evento)

        metodo, _propiedades, cuerpo = canal.basic_get(
            queue=topologia.COLA_RESUMEN, auto_ack=True
        )
        assert metodo is not None, "el mensaje no llegó a la cola del resumen"
        sobre = json.loads(cuerpo)
        assert sobre["evento"] == "suscripcion.creada"
        assert sobre["version"] == 2
        assert sobre["organizacion_id"] == str(org)

    def test_de_crear_a_resumen_persistido(self, canal):
        """El recorrido entero: crear, despachar, recibir, recalcular."""
        from django.core.management import call_command  # noqa: PLC0415

        org = uuid.uuid4()
        una_suscripcion(org)
        # Nace sin resumen: el POST no lo calcula con la bandera en asíncrono.
        assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()

        evento = registrar_creada(Subscription.objects.get(organizacion_id=org))
        publicador.publicar(evento)

        # Lo que hace el consumidor al recibirlo. Se llama en el proceso y no
        # con `manage.py consumir_eventos` porque la base de pruebas vive en
        # esta conexión: un subproceso no la vería.
        from app.management.commands.consumir_eventos import validar  # noqa: PLC0415

        metodo, _props, cuerpo = canal.basic_get(
            queue=topologia.COLA_RESUMEN, auto_ack=True
        )
        assert metodo is not None
        recalcular_resumen(validar(cuerpo))

        resumen = ResumenOrganizacion.objects.get(organizacion_id=org)
        assert resumen.moneda == "CLP"
        assert resumen.total_mensual == Decimal("9990.00")
        assert resumen.cantidad_activas == 1
        assert call_command  # el import se usa arriba; silencia el linter

    def test_la_cola_de_fallos_existe_y_esta_enlazada(self, canal):
        """Sin esto, un reject sin reencolar borra el mensaje."""
        publicado = canal.basic_publish(
            exchange=topologia.EXCHANGE_FALLIDOS,
            routing_key="",
            body=b'{"prueba": true}',
        )
        assert publicado is None  # pika devuelve None cuando salió bien
        cuerpo = esperar_mensaje(canal, topologia.COLA_FALLIDOS)
        assert cuerpo is not None
        assert json.loads(cuerpo) == {"prueba": True}

    def test_un_mensaje_rechazado_termina_en_la_cola_de_fallos(self, canal):
        """El dead-letter exchange, comprobado contra el broker de verdad.

        Es lo que convierte "se perdió" en "está apartado y se puede mirar".
        """
        org = uuid.uuid4()
        evento = registrar_creada(una_suscripcion(org))
        publicador.publicar(evento)

        metodo, _props, _cuerpo = canal.basic_get(
            queue=topologia.COLA_RESUMEN, auto_ack=False
        )
        assert metodo is not None
        canal.basic_reject(delivery_tag=metodo.delivery_tag, requeue=False)

        cuerpo2 = esperar_mensaje(canal, topologia.COLA_FALLIDOS)
        assert cuerpo2 is not None, (
            "el mensaje rechazado se perdió en vez de ir a la cola de fallos"
        )
        assert json.loads(cuerpo2)["organizacion_id"] == str(org)

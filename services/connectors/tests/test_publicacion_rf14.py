"""RF-14: publicar las órdenes de cobro que deja la confirmación.

`confirmacion.confirmar` deja la orden en el outbox; `publicacion` la manda a
`connectors.eventos` y la marca publicada solo con el broker confirmando. Lo
que se prueba:

  · el sobre que sale de una confirmación DE VERDAD cumple el contrato que
    lee subscriptions (mismo archivo de shared/, no una copia);
  · exchange, routing key, persistencia y `mandatory`;
  · un fallo deja la fila pendiente con espera creciente;
  · sin RABBITMQ_URL no se toca nada;
  · beat la programa.
"""

from __future__ import annotations

import json
import uuid
from datetime import timedelta

import pika
import pytest
from django.conf import settings
from django.utils import timezone

from connectors import confirmacion, publicacion
from connectors.models import CobroCandidato, OutboxEvento
from shared.contratos import candidato_confirmado as contrato
from tests.test_confirmar_candidatos import crear_candidato

pytestmark = pytest.mark.django_db


@pytest.fixture
def con_broker(settings):
    settings.RABBITMQ_URL = "amqp://guest:guest@broker-de-prueba:5672/"


def orden_confirmada(**kwargs) -> OutboxEvento:
    candidato = crear_candidato(**kwargs)
    assert confirmacion.confirmar(candidato, por="42")
    return OutboxEvento.objects.get(datos__candidato_id=str(candidato.id))


# ── el contrato ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "tipo", [t for t, _ in CobroCandidato.TipoMensaje.choices],
)
def test_el_sobre_de_una_confirmacion_real_cumple_el_contrato(tipo):
    sobre = publicacion.crear_sobre(orden_confirmada(tipo=tipo, identificador=f"sha:{tipo}"))
    assert contrato.errores(sobre) == []
    assert (sobre["evento"], sobre["version"]) == ("candidato.confirmado", 1)
    assert sobre["ocurrido_en"].endswith("Z")
    # El importe viaja como texto con dos decimales, también en pesos.
    assert sobre["datos"]["importe"] == "9990.00"


def test_un_correo_tambien_cumple_el_contrato():
    candidato = crear_candidato(identificador="<abc@netflix.com>")
    CobroCandidato.objects.filter(pk=candidato.pk).update(origen=CobroCandidato.Origen.CORREO)
    candidato.refresh_from_db()
    confirmacion.confirmar(candidato, por="42")
    sobre = publicacion.crear_sobre(OutboxEvento.objects.get())
    assert contrato.errores(sobre) == []
    assert sobre["datos"]["origen"] == "correo"


def test_el_nombre_del_evento_sale_del_contrato_compartido():
    assert (confirmacion.EVENTO, confirmacion.VERSION) == (contrato.EVENTO, contrato.VERSION)


# ── publicar ─────────────────────────────────────────────────────────────


class CanalFalso:
    def __init__(self):
        self.declarado = []
        self.publicado = []
        self.confirma = False

    def exchange_declare(self, **kw):
        self.declarado.append(("exchange", kw))

    def queue_declare(self, **kw):
        self.declarado.append(("cola", kw))

    def queue_bind(self, **kw):
        self.declarado.append(("enlace", kw))

    def confirm_delivery(self):
        self.confirma = True

    def basic_publish(self, **kw):
        assert self.confirma, "publicó sin confirmación del broker"
        self.publicado.append(kw)


class ConexionFalsa:
    def __init__(self, _parametros):
        self.canal = CanalFalso()
        self.is_open = True
        ConexionFalsa.ultima = self

    def channel(self):
        return self.canal

    def close(self):
        self.is_open = False


def test_publica_persistente_y_obligatorio_a_la_clave_exacta(con_broker, monkeypatch):
    monkeypatch.setattr(pika, "BlockingConnection", ConexionFalsa)
    evento = orden_confirmada()
    publicacion.publicar(evento)

    canal = ConexionFalsa.ultima.canal
    (envio,) = canal.publicado
    assert (envio["exchange"], envio["routing_key"]) == ("connectors.eventos", "candidato.confirmado.v1")
    assert envio["mandatory"] is True
    assert envio["properties"].delivery_mode == pika.DeliveryMode.Persistent.value
    assert envio["properties"].message_id == str(evento.id)
    assert json.loads(envio["body"]) == publicacion.crear_sobre(evento)
    # Declara la cola del consumidor: si arranca antes que subscriptions, el
    # mensaje espera en ella en vez de volver como no enrutable.
    assert ("enlace", {"exchange": "connectors.eventos", "queue": "subscriptions.candidatos",
                       "routing_key": "candidato.confirmado.v1"}) in canal.declarado
    assert not ConexionFalsa.ultima.is_open


def test_una_fila_que_no_es_del_contrato_no_se_publica(con_broker, monkeypatch):
    monkeypatch.setattr(pika, "BlockingConnection", ConexionFalsa)
    ConexionFalsa.ultima = None
    evento = orden_confirmada()
    evento.datos = {**evento.datos, "importe": 9990}
    with pytest.raises(publicacion.EventoSinContrato):
        publicacion.publicar(evento)
    assert ConexionFalsa.ultima is None  # ni siquiera abrió la conexión


# ── despachar ────────────────────────────────────────────────────────────


def test_despachar_publica_y_marca(con_broker):
    evento = orden_confirmada()
    publicadas = []
    resultado = publicacion.despachar_pendientes(publicar_uno=publicadas.append)
    assert resultado == {"publicados": 1, "reintentados": 0, "sin_broker": 0}
    assert publicadas == [evento]
    evento.refresh_from_db()
    assert evento.publicado_en is not None
    # Una segunda pasada no la vuelve a mandar.
    assert publicacion.despachar_pendientes(publicar_uno=publicadas.append)["publicados"] == 0
    assert len(publicadas) == 1


@pytest.mark.parametrize(
    "error", [pika.exceptions.UnroutableError([]), pika.exceptions.AMQPConnectionError(), OSError("red")],
)
def test_un_fallo_la_deja_pendiente_con_espera_creciente(con_broker, error):
    evento = orden_confirmada()

    def falla(_evento):
        raise error

    antes = timezone.now()
    assert publicacion.despachar_pendientes(publicar_uno=falla)["reintentados"] == 1
    evento.refresh_from_db()
    assert evento.publicado_en is None
    assert evento.intentos == 1
    assert evento.ultimo_error == type(error).__name__
    assert evento.siguiente_intento >= antes + timedelta(seconds=5)

    # Mientras no se cumpla la espera, no se reintenta.
    assert publicacion.despachar_pendientes(publicar_uno=falla)["reintentados"] == 0

    OutboxEvento.objects.filter(pk=evento.pk).update(siguiente_intento=timezone.now())
    publicacion.despachar_pendientes(publicar_uno=falla)
    evento.refresh_from_db()
    assert evento.intentos == 2
    assert evento.siguiente_intento >= timezone.now() + timedelta(seconds=9)


def test_la_espera_tiene_techo():
    assert publicacion._espera(1) == 5
    assert publicacion._espera(2) == 10
    assert publicacion._espera(50) == publicacion.REINTENTO_MAXIMO_SEGUNDOS


def test_un_error_que_no_es_del_broker_no_se_traga(con_broker):
    orden_confirmada()

    def revienta(_evento):
        raise RuntimeError("bug")

    with pytest.raises(RuntimeError):
        publicacion.despachar_pendientes(publicar_uno=revienta)
    assert OutboxEvento.objects.get().intentos == 0


def test_sin_broker_no_toca_ninguna_fila(settings):
    settings.RABBITMQ_URL = ""
    evento = orden_confirmada()
    llamadas = []
    resultado = publicacion.despachar_pendientes(publicar_uno=llamadas.append)
    assert resultado == {"publicados": 0, "reintentados": 0, "sin_broker": 1}
    assert llamadas == []
    evento.refresh_from_db()
    assert (evento.publicado_en, evento.intentos) == (None, 0)


def test_publica_en_orden_de_llegada(con_broker):
    primera = orden_confirmada(identificador="sha:1")
    segunda = orden_confirmada(identificador="sha:3")
    OutboxEvento.objects.filter(pk=primera.pk).update(creado_en=timezone.now() - timedelta(minutes=1))
    vistas = []
    publicacion.despachar_pendientes(publicar_uno=lambda e: vistas.append(e.pk))
    assert vistas == [primera.pk, segunda.pk]


# ── la programación ──────────────────────────────────────────────────────


def test_beat_la_programa_y_la_tarea_existe():
    from connectors import tasks

    entrada = settings.CELERY_BEAT_SCHEDULE["despacho-de-eventos"]
    assert entrada["task"] == "connectors.tasks.despachar_eventos"
    assert 0 < entrada["schedule"] <= 60
    assert tasks.despachar_eventos.name == entrada["task"]


def test_la_tarea_despacha(con_broker, monkeypatch):
    from connectors import tasks

    monkeypatch.setattr(publicacion, "publicar", lambda _e: None)
    orden_confirmada()
    assert tasks.despachar_eventos()["publicados"] == 1


def test_el_id_del_sobre_es_estable_entre_reintentos(con_broker):
    """El consumidor deduplica por candidato, pero el id del sobre es lo que
    se ve en los logs de los dos lados: no puede cambiar entre intentos."""
    evento = orden_confirmada()
    assert publicacion.crear_sobre(evento)["id"] == publicacion.crear_sobre(
        OutboxEvento.objects.get(pk=evento.pk)
    )["id"] == str(evento.id)
    uuid.UUID(str(evento.id))


# ── el rango del importe (revisión de #242) ──────────────────────────────


def test_el_maximo_que_cabe_en_subscriptions_se_confirma_y_cumple_el_contrato():
    sobre = publicacion.crear_sobre(orden_confirmada(importe="99999999.99"))
    assert sobre["datos"]["importe"] == "99999999.99"
    assert contrato.errores(sobre) == []


def test_un_importe_que_no_cabe_no_se_confirma_ni_deja_orden():
    from rest_framework.test import APIClient

    from tests.test_confirmar_candidatos import cabecera, confirmar

    candidato = crear_candidato(importe="100000000.00")
    with pytest.raises(confirmacion.ConfirmacionRechazada) as rechazo:
        confirmacion.confirmar(candidato, por="42")
    assert rechazo.value.codigo == confirmacion.IMPORTE_FUERA_DE_RANGO

    respuesta = confirmar(APIClient(), candidato, headers=cabecera())
    assert respuesta.status_code == 409
    assert respuesta.json()["codigo"] == "importe_fuera_de_rango"
    candidato.refresh_from_db()
    # Recuperable: sigue propuesto y se puede rechazar.
    assert candidato.estado == CobroCandidato.Estado.PROPUESTO
    assert not OutboxEvento.objects.exists()


def test_el_contrato_rechaza_lo_que_no_cabe():
    sobre = publicacion.crear_sobre(orden_confirmada())
    sobre["datos"]["importe"] = "100000000.00"
    assert contrato.errores(sobre)
    assert str(contrato.IMPORTE_MAXIMO) == "99999999.99"

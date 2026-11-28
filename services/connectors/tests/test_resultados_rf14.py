"""RF-14, la vuelta: lo que subscriptions contestó de cada orden de cobro.

La segunda revisión de #242: `por_enviar`/`enviada` son estados de
publicación, no de aplicación. subscriptions contesta `candidato.aplicado` v1
(`shared/contratos/candidato_aplicado.py`) y `resultados.py` lo deja en el
candidato. Lo que se prueba:

  · la respuesta lleva el candidato a `aplicada` o `fallida` en la API;
  · es idempotente: una reentrega no cambia nada, un `aplicado` corrige un
    `fallido` y un `fallido` nunca pisa un `aplicado`;
  · no toca candidatos ajenos ni los que no están confirmados;
  · un sobre fuera de contrato va a fallos y la base caída se reintenta;
  · contra un RabbitMQ de verdad, la respuesta se recoge de su cola.
"""

from __future__ import annotations

import json
import os
import uuid

import pytest
from rest_framework.test import APIClient

from connectors import resultados, tasks
from connectors.models import CobroCandidato
from shared.contratos import candidato_aplicado as contrato
from tests.test_confirmar_segunda_revision import cabecera, confirmar_por_http, crear_candidato

pytestmark = pytest.mark.django_db


def respuesta(candidato, *, resultado="aplicado", motivo=None, org=None, ocurrido_en="2026-11-28T03:00:00.123Z"):
    motivo = motivo or ("cobro_creado" if resultado == "aplicado" else "no_aplicable")
    aplicado = resultado == "aplicado"
    sobre = {
        "evento": "candidato.aplicado",
        "version": 1,
        "id": str(uuid.uuid4()),
        "ocurrido_en": ocurrido_en,
        "correlation_id": str(uuid.uuid4()),
        "organizacion_id": str(org or candidato.organizacion_id),
        "datos": {
            "candidato_id": str(candidato.pk),
            "orden_id": str(uuid.uuid4()),
            "resultado": resultado,
            "motivo": motivo,
            "suscripcion_id": str(uuid.uuid4()) if aplicado else None,
            "cobro_id": str(uuid.uuid4()) if motivo == "cobro_creado" else None,
        },
    }
    assert contrato.errores(sobre) == [], "el doble tiene que cumplir el contrato"
    return sobre


def confirmado(org=None, **kw):
    candidato = crear_candidato(org or uuid.uuid4(), **kw)
    assert confirmar_por_http(candidato).status_code == 200
    candidato.refresh_from_db()
    return candidato


def aplicacion(candidato):
    detalle = APIClient().get(f"/api/candidatos/{candidato.pk}/", headers=cabecera(candidato.organizacion_id))
    assert detalle.status_code == 200
    return detalle.json()["aplicacion"]


def recibir(sobre):
    return resultados.procesar(json.dumps(sobre).encode())


# ── lo que muestra la API ────────────────────────────────────────────────


def test_aplicado_deja_el_candidato_aplicado():
    candidato = confirmado()
    desenlace = recibir(respuesta(candidato))
    assert (desenlace.confirmar, desenlace.motivo) == (True, "guardada")
    assert aplicacion(candidato) == "aplicada"
    candidato.refresh_from_db()
    assert (candidato.resultado_aplicacion, candidato.motivo_aplicacion) == ("aplicado", "cobro_creado")
    assert candidato.orden_aplicada_en.isoformat().startswith("2026-11-28T03:00:00.123")


def test_un_aviso_aplicado_sin_cobro_tambien_es_aplicada():
    candidato = confirmado()
    recibir(respuesta(candidato, motivo="sin_cobro"))
    assert aplicacion(candidato) == "aplicada"


def test_fallido_deja_el_candidato_fallido():
    candidato = confirmado()
    recibir(respuesta(candidato, resultado="fallido"))
    assert aplicacion(candidato) == "fallida"


def test_la_respuesta_manda_aunque_el_envio_no_se_haya_marcado():
    # Puede llegar antes de que el publicador cierre su transacción.
    candidato = confirmado()
    assert candidato.orden_enviada_en is None
    recibir(respuesta(candidato))
    assert aplicacion(candidato) == "aplicada"


# ── idempotente ──────────────────────────────────────────────────────────


def test_una_reentrega_no_cambia_nada():
    candidato = confirmado()
    sobre = respuesta(candidato)
    recibir(sobre)
    candidato.refresh_from_db()
    antes = candidato.orden_aplicada_en
    desenlace = recibir(sobre)
    assert (desenlace.confirmar, desenlace.motivo) == (True, "sin_cambios")
    candidato.refresh_from_db()
    assert candidato.orden_aplicada_en == antes


def test_un_aplicado_despues_de_un_fallido_lo_corrige():
    # Alguien reprocesó la cola de fallos de subscriptions y esta vez salió.
    candidato = confirmado()
    recibir(respuesta(candidato, resultado="fallido"))
    recibir(respuesta(candidato))
    assert aplicacion(candidato) == "aplicada"


def test_un_fallido_nunca_pisa_un_aplicado():
    candidato = confirmado()
    recibir(respuesta(candidato))
    assert recibir(respuesta(candidato, resultado="fallido")).motivo == "sin_cambios"
    assert aplicacion(candidato) == "aplicada"


# ── a quién le toca ──────────────────────────────────────────────────────


def test_la_de_otra_organizacion_no_toca_nada_y_se_confirma_igual():
    candidato = confirmado()
    desenlace = recibir(respuesta(candidato, org=uuid.uuid4()))
    assert (desenlace.confirmar, desenlace.motivo) == (True, "sin_cambios")
    assert aplicacion(candidato) == "por_enviar"


def test_un_candidato_que_no_existe_se_confirma_sin_cambios():
    fantasma = CobroCandidato(pk=uuid.uuid4(), organizacion_id=uuid.uuid4())
    assert recibir(respuesta(fantasma)).confirmar


def test_un_candidato_sin_confirmar_no_cambia():
    propuesto = crear_candidato(uuid.uuid4())
    recibir(respuesta(propuesto))
    propuesto.refresh_from_db()
    assert propuesto.resultado_aplicacion == ""


# ── lo que no se puede guardar ───────────────────────────────────────────


@pytest.mark.parametrize(
    "romper",
    [
        lambda s: s.update(version=2),
        lambda s: s["datos"].update(resultado="aplicada"),
        lambda s: s["datos"].update(motivo="no_aplicable"),           # aplicado con motivo de fallo
        lambda s: s["datos"].update(suscripcion_id=None),             # aplicado sin suscripción
        lambda s: s["datos"].update(cobro_id=None),                   # cobro_creado sin cobro
        lambda s: s["datos"].pop("orden_id"),
        lambda s: s["datos"].update(extra=1),
    ],
)
def test_un_sobre_fuera_de_contrato_va_a_fallos_sin_reintentar(romper):
    candidato = confirmado()
    sobre = respuesta(candidato)
    romper(sobre)
    desenlace = recibir(sobre)
    assert (desenlace.confirmar, desenlace.reintentar) == (False, False)
    assert aplicacion(candidato) == "por_enviar"


def test_un_fallido_con_ids_de_aplicado_no_cumple():
    candidato = confirmado()
    sobre = respuesta(candidato, resultado="fallido")
    sobre["datos"]["suscripcion_id"] = str(uuid.uuid4())
    assert not recibir(sobre).confirmar


def test_no_es_json():
    assert not resultados.procesar(b"{no").confirmar


def test_la_base_caida_se_reintenta(monkeypatch):
    from django.db.utils import OperationalError

    def se_cayo(_sobre):
        raise OperationalError("se cayó")

    monkeypatch.setattr(resultados, "aplicar_respuesta", se_cayo)
    desenlace = recibir(respuesta(confirmado()))
    assert (desenlace.confirmar, desenlace.reintentar) == (False, True)


# ── la pasada del worker ─────────────────────────────────────────────────


class _Metodo:
    def __init__(self, etiqueta):
        self.delivery_tag = etiqueta


class CanalDeMentira:
    def __init__(self, cuerpos):
        self.cuerpos = list(cuerpos)
        self.acks, self.nacks, self.declarado = [], [], False

    def exchange_declare(self, **_kw):
        self.declarado = True

    def queue_declare(self, **_kw):
        pass

    def queue_bind(self, **_kw):
        pass

    def basic_get(self, *, queue, auto_ack):
        assert (queue, auto_ack) == (contrato.COLA, False)
        if not self.cuerpos:
            return None, None, None
        return _Metodo(len(self.cuerpos)), None, self.cuerpos.pop(0)

    def basic_ack(self, *, delivery_tag):
        self.acks.append(delivery_tag)

    def basic_nack(self, *, delivery_tag, requeue):
        self.nacks.append((delivery_tag, requeue))


class ConexionDeMentira:
    def __init__(self, canal):
        self._canal, self.is_open = canal, True

    def channel(self):
        return self._canal

    def close(self):
        self.is_open = False


def test_sin_broker_no_hace_nada(settings):
    settings.RABBITMQ_URL = ""
    assert resultados.recoger_pendientes(conectar=lambda: pytest.fail("no debía conectarse"))["sin_broker"] == 1


def test_la_pasada_confirma_lo_guardado_y_aparta_lo_malo(settings, monkeypatch):
    monkeypatch.setattr(resultados, "close_old_connections", lambda: None)
    settings.RABBITMQ_URL = "amqp://prueba@broker-de-prueba:5672/"
    bueno, otro = confirmado(), confirmado()
    canal = CanalDeMentira([
        json.dumps(respuesta(bueno)).encode(),
        b"{no",
        json.dumps(respuesta(otro, resultado="fallido")).encode(),
    ])
    conexion = ConexionDeMentira(canal)

    cuenta = resultados.recoger_pendientes(conectar=lambda: conexion)

    assert canal.declarado and not conexion.is_open
    assert cuenta == {"guardadas": 2, "sin_cambios": 0, "apartadas": 1, "sin_broker": 0}
    assert len(canal.acks) == 2 and [requeue for _t, requeue in canal.nacks] == [False]
    assert (aplicacion(bueno), aplicacion(otro)) == ("aplicada", "fallida")


def test_con_la_base_caida_devuelve_el_mensaje_y_corta_la_pasada(settings, monkeypatch):
    from django.db.utils import OperationalError

    monkeypatch.setattr(resultados, "close_old_connections", lambda: None)
    settings.RABBITMQ_URL = "amqp://prueba@broker-de-prueba:5672/"

    def se_cayo(_sobre):
        raise OperationalError("se cayó")

    monkeypatch.setattr(resultados, "aplicar_respuesta", se_cayo)
    a, b = confirmado(), confirmado()
    canal = CanalDeMentira([json.dumps(respuesta(a)).encode(), json.dumps(respuesta(b)).encode()])

    resultados.recoger_pendientes(conectar=lambda: ConexionDeMentira(canal))

    assert canal.nacks == [(2, True)] and canal.acks == []
    assert len(canal.cuerpos) == 1, "siguió sacando mensajes con la base caída"


def test_beat_la_programa_con_el_despacho(settings):
    entrada = settings.CELERY_BEAT_SCHEDULE["recoger-resultados-de-ordenes"]
    assert entrada["task"] == tasks.recoger_resultados.name == "connectors.tasks.recoger_resultados"
    assert entrada["schedule"] == settings.CELERY_BEAT_SCHEDULE["despacho-de-eventos"]["schedule"]


# ── contra un RabbitMQ de verdad ─────────────────────────────────────────

URL_PRUEBA = os.environ.get("RABBITMQ_PRUEBA_URL", "")


@pytest.mark.skipif(not URL_PRUEBA, reason="necesita un RabbitMQ real; definir RABBITMQ_PRUEBA_URL")
def test_por_el_broker_la_respuesta_se_recoge_y_lo_malo_termina_en_fallos(settings, monkeypatch):
    import time

    import pika

    monkeypatch.setattr(resultados, "close_old_connections", lambda: None)
    settings.RABBITMQ_URL = URL_PRUEBA
    conexion = pika.BlockingConnection(pika.URLParameters(URL_PRUEBA))
    canal = conexion.channel()
    for cola in (contrato.COLA, contrato.COLA_FALLIDOS):
        try:
            canal.queue_delete(queue=cola)
        except pika.exceptions.ChannelClosedByBroker:
            canal = conexion.channel()
    contrato.declarar(canal)
    canal.confirm_delivery()
    candidato = confirmado()
    for cuerpo in (json.dumps(respuesta(candidato)).encode(), b'{"evento": "otra cosa"}'):
        canal.basic_publish(exchange=contrato.EXCHANGE, routing_key=contrato.ROUTING_KEY, body=cuerpo,
                            mandatory=True)

    cuenta = resultados.recoger_pendientes()

    assert (cuenta["guardadas"], cuenta["apartadas"]) == (1, 1)
    assert aplicacion(candidato) == "aplicada"
    for _ in range(25):
        metodo, _p, cuerpo = canal.basic_get(queue=contrato.COLA_FALLIDOS, auto_ack=True)
        if metodo is not None:
            break
        time.sleep(0.2)
    assert metodo is not None and json.loads(cuerpo) == {"evento": "otra cosa"}
    conexion.close()

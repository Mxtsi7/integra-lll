"""Pruebas del productor de eventos y del outbox MX-21 v2."""

import json
from datetime import date, timedelta
from decimal import Decimal
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pika
import pytest
from django.utils import timezone
from jsonschema import Draft202012Validator, FormatChecker
from rest_framework import status
from rest_framework.test import APIClient

from app.models import OutboxEvento, Subscription
from events.despacho import despachar_pendientes
from events.outbox import registrar_creada
from events.publicador import crear_payload, publicar


CUERPO = {
    "nombre": "Netflix",
    "monto": "9990.00",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-01",
    "categoria": "streaming",
    "estado": "activo",
}
SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "shared" / "events" / "mx21-v2.schema.json"
)


def _validar_contrato(evento: OutboxEvento) -> dict:
    payload = crear_payload(evento)
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator(
        schema, format_checker=FormatChecker()
    ).validate(payload)
    return payload


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def organizacion() -> uuid.UUID:
    return uuid.uuid4()


def crear_suscripcion(organizacion_id: uuid.UUID) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=organizacion_id,
        nombre="Netflix",
        monto=Decimal("9990.00"),
        moneda="CLP",
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria="streaming",
        estado=Subscription.Estado.ACTIVO,
    )


@pytest.mark.django_db
def test_creacion_persiste_evento_v2_con_correlacion_y_schema(api_client, organizacion):
    correlation_id = uuid.uuid4()
    response = api_client.post(
        "/api/suscripciones/",
        CUERPO,
        format="json",
        headers={
            "X-Organizacion-Id": str(organizacion),
            "X-Correlation-ID": str(correlation_id),
        },
    )

    assert response.status_code == status.HTTP_201_CREATED
    evento = OutboxEvento.objects.get(evento="suscripcion.creada")
    payload = _validar_contrato(evento)
    assert evento.organizacion_id == organizacion
    assert evento.correlation_id == correlation_id
    assert payload["datos"]["suscripcion_id"] == response.data["id"]
    assert payload["datos"]["monto"] == "9990.00"
    assert payload["version"] == 2


@pytest.mark.django_db
def test_actualizacion_y_transicion_publican_hechos_separados_con_misma_correlacion(
    api_client, organizacion
):
    suscripcion = crear_suscripcion(organizacion)
    correlation_id = uuid.uuid4()
    response = api_client.patch(
        f"/api/suscripciones/{suscripcion.id}/",
        {"monto": "12990.00", "estado": "cancelado"},
        format="json",
        headers={
            "X-Organizacion-Id": str(organizacion),
            "X-Correlation-ID": str(correlation_id),
            "X-Usuario-Id": "42",
            "X-Rol": "titular",
        },
    )

    assert response.status_code == status.HTTP_200_OK
    eventos = list(OutboxEvento.objects.order_by("evento"))
    assert [evento.evento for evento in eventos] == [
        "suscripcion.actualizada",
        "suscripcion.estado_cambiado",
    ]
    assert eventos[0].datos["campos_modificados"] == ["monto"]
    assert eventos[1].datos["estado_anterior"] == Subscription.Estado.ACTIVO
    assert eventos[1].datos["estado"] == Subscription.Estado.CANCELADO
    assert eventos[1].datos["evento_estado"] == (
        Subscription.EventoEstado.CANCELACION_USUARIO
    )
    assert eventos[0].correlation_id == correlation_id
    assert eventos[1].correlation_id == correlation_id
    assert eventos[0].id != eventos[1].id
    for evento in eventos:
        _validar_contrato(evento)


@pytest.mark.django_db
def test_una_transaccion_fallida_revierte_suscripcion_y_outbox(
    api_client, organizacion
):
    from app.views import registrar_creada as guardar_evento

    def guardar_y_fallar(suscripcion, correlation_id=None):
        guardar_evento(suscripcion, correlation_id)
        raise RuntimeError("fallo simulado antes del commit")

    with patch("app.views.registrar_creada", side_effect=guardar_y_fallar):
        with pytest.raises(RuntimeError, match="fallo simulado"):
            api_client.post(
                "/api/suscripciones/",
                CUERPO,
                format="json",
                headers={"X-Organizacion-Id": str(organizacion)},
            )

    assert not Subscription.objects.filter(organizacion_id=organizacion).exists()
    assert not OutboxEvento.objects.exists()
    with patch("events.despacho.publicar") as publicar:
        assert despachar_pendientes() == {"publicados": 0, "reintentados": 0}
    publicar.assert_not_called()


@pytest.mark.django_db
def test_reintentos_reutilizan_id_y_marcan_publicado_solo_con_ack(organizacion):
    suscripcion = crear_suscripcion(organizacion)
    evento = registrar_creada(suscripcion)
    id_evento = evento.id
    correlation_id = evento.correlation_id
    error_broker = pika.exceptions.AMQPError("broker no disponible")

    with patch("events.despacho.publicar", side_effect=error_broker) as publicar:
        assert despachar_pendientes() == {"publicados": 0, "reintentados": 1}
    publicar.assert_called_once()
    assert publicar.call_args.args[0].id == id_evento

    evento.refresh_from_db()
    assert evento.publicado_en is None
    assert evento.intentos == 1
    assert evento.ultimo_error == "AMQPError"

    evento.siguiente_intento = timezone.now() - timedelta(seconds=1)
    evento.save(update_fields=("siguiente_intento",))
    with patch("events.despacho.publicar") as publicar:
        assert despachar_pendientes() == {"publicados": 1, "reintentados": 0}
    assert publicar.call_args.args[0].id == id_evento

    evento.refresh_from_db()
    assert evento.publicado_en is not None
    assert evento.correlation_id == correlation_id


@pytest.mark.django_db
def test_publicador_envia_routing_v2_durable_y_obligatorio(organizacion):
    evento = registrar_creada(crear_suscripcion(organizacion))
    conexion = MagicMock()
    canal = conexion.channel.return_value
    canal.basic_publish.return_value = None  # Contrato real de pika 1.x.

    with patch("events.publicador.pika.BlockingConnection", return_value=conexion):
        publicar(evento)

    canal.exchange_declare.assert_called_once_with(
        exchange="suscripciones",
        exchange_type="topic",
        durable=True,
    )
    canal.confirm_delivery.assert_called_once_with()
    kwargs = canal.basic_publish.call_args.kwargs
    assert kwargs["routing_key"] == "suscripcion.creada.v2"
    assert kwargs["mandatory"] is True
    assert json.loads(kwargs["body"])["id"] == str(evento.id)
    assert kwargs["properties"].message_id == str(evento.id)
    assert kwargs["properties"].delivery_mode == pika.DeliveryMode.Persistent.value
    assert kwargs["properties"].content_type == "application/json"
    conexion.close.assert_called_once_with()


@pytest.mark.django_db
def test_publicador_propagaa_nack_del_broker(organizacion):
    """Regresión VI-26/pika-1.x: en publisher-confirms mode el broker rechaza con
    NackError (no devuelve False). El publicador debe dejar que esa excepción
    suba para que despacho.py la contabilice como fallo y reintente.

    NOTA: este test pertenece a la rama vi-26; debe moverse junto con los commits
    del outbox (5e8688c, 541a022, 4fab085) cuando se abra esa PR.
    El workflow ideal es probarlo contra un RabbitMQ real (ver el CI de #79).
    """
    evento = registrar_creada(crear_suscripcion(organizacion))
    conexion = MagicMock()
    nack = pika.exceptions.NackError([])
    conexion.channel.return_value.basic_publish.side_effect = nack

    with patch("events.publicador.pika.BlockingConnection", return_value=conexion):
        with pytest.raises(pika.exceptions.NackError):
            publicar(evento)

    conexion.close.assert_called_once_with()



@pytest.mark.django_db
def test_transicion_de_estado_publica_su_causa(organizacion):
    suscripcion = crear_suscripcion(organizacion)
    suscripcion.estado = Subscription.Estado.PRUEBA
    suscripcion.fin_prueba = timezone.localdate() - timedelta(days=1)
    suscripcion.save(update_fields=("estado", "fin_prueba"))

    suscripcion.transicionar(Subscription.EventoEstado.FIN_PRUEBA)

    evento = OutboxEvento.objects.get()
    assert evento.evento == "suscripcion.estado_cambiado"
    assert evento.datos["estado_anterior"] == Subscription.Estado.PRUEBA
    assert evento.datos["estado"] == Subscription.Estado.ACTIVO
    assert evento.datos["evento_estado"] == Subscription.EventoEstado.FIN_PRUEBA
    _validar_contrato(evento)

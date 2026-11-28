"""Drainer del outbox de confirmaciones: sobre, reintentos y despacho."""

from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import pika
import pytest
from django.core.management import call_command
from django.utils import timezone
from io import StringIO

from connectors.models import OutboxEvento
from connectors.tasks import publicar_eventos_confirmados
from events.despacho import despachar_pendientes
from events.publicador import crear_payload


def crear_outbox(**cambios):
    valores = dict(
        organizacion_id=uuid4(),
        evento="candidato.confirmado",
        version=1,
        correlation_id=uuid4(),
        datos={"candidato_id": str(uuid4()), "crear_cobro": True},
    )
    valores.update(cambios)
    return OutboxEvento.objects.create(**valores)


def test_crear_payload_saca_tenant_e_id_de_las_columnas():
    fila = OutboxEvento(
        id=uuid4(),
        organizacion_id=uuid4(),
        correlation_id=uuid4(),
        evento="candidato.confirmado",
        version=1,
        datos={"crear_cobro": False},
    )
    sobre = crear_payload(fila)
    assert sobre["id"] == str(fila.id)
    assert sobre["organizacion_id"] == str(fila.organizacion_id)
    assert sobre["correlation_id"] == str(fila.correlation_id)
    assert sobre["evento"] == "candidato.confirmado"
    assert sobre["version"] == 1
    assert sobre["datos"] == {"crear_cobro": False}
    assert sobre["ocurrido_en"].endswith("Z")


@pytest.mark.django_db
def test_despachar_marca_publicado_y_no_reenvia():
    fila = crear_outbox()
    with patch("events.despacho.publicar") as publicar:
        assert despachar_pendientes() == {"publicados": 1, "reintentados": 0}
        assert despachar_pendientes() == {"publicados": 0, "reintentados": 0}
    assert publicar.call_count == 1
    fila.refresh_from_db()
    assert fila.publicado_en is not None
    assert fila.ultimo_error == ""
    assert fila.intentos == 0


@pytest.mark.django_db
def test_fallo_de_rabbit_incrementa_intentos_y_programa_reintento():
    fila = crear_outbox()
    with patch(
        "events.despacho.publicar",
        side_effect=pika.exceptions.AMQPConnectionError("caído"),
    ):
        assert despachar_pendientes() == {"publicados": 0, "reintentados": 1}
    fila.refresh_from_db()
    assert fila.publicado_en is None
    assert fila.intentos == 1
    assert fila.ultimo_error == "AMQPConnectionError"
    assert fila.siguiente_intento > timezone.now() + timedelta(seconds=4)

    fila.siguiente_intento = timezone.now() - timedelta(seconds=1)
    fila.save(update_fields=["siguiente_intento"])
    with patch("events.despacho.publicar"):
        assert despachar_pendientes() == {"publicados": 1, "reintentados": 0}
    fila.refresh_from_db()
    assert fila.publicado_en is not None


@pytest.mark.django_db
def test_comando_y_task_usan_el_mismo_despacho():
    crear_outbox()
    salida = StringIO()
    with patch("events.despacho.publicar"):
        call_command("publicar_eventos_confirmados", stdout=salida)
    assert "publicados=1" in salida.getvalue()

    with patch(
        "events.despacho.despachar_pendientes",
        return_value={"publicados": 2, "reintentados": 1},
    ) as despacho:
        assert publicar_eventos_confirmados.run() == {
            "publicados": 2,
            "reintentados": 1,
        }
    despacho.assert_called_once_with()

"""Pruebas del publicador fiable de uso (S3-VI-07).

No levantan broker: fijan el sobre, el outbox, el ruteo del despachador y la
topología. La prueba de integración real vive en
``services/analytics-uso/tests/integracion``.
"""

import datetime as dt
import json
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from jsonschema import Draft202012Validator, FormatChecker

from app.models import OutboxEvento
from events.despacho import despachar_pendientes
from events.uso import (
    COLA_FALLOS_USO,
    COLA_USO,
    EVENTO_USO,
    EXCHANGE_DLX_USO,
    EXCHANGE_USO,
    ROUTING_KEY_USO,
    VERSION_USO,
    _iso_utc,
    crear_sobre_uso,
    datos_uso,
    declarar_uso,
    publicar_uso,
    registrar_uso,
)

RAIZ = Path(__file__).resolve().parents[3]
ESQUEMA = json.loads(
    (RAIZ / "docs" / "contratos" / "uso-recolectores-v1.schema.json").read_text(
        encoding="utf-8"
    )
)
VALIDADOR = Draft202012Validator(ESQUEMA, format_checker=FormatChecker())

EVENT_ID = "22222222-2222-4222-8222-222222222222"
RECOLECTOR_ID = "33333333-3333-4333-8333-333333333333"
SUSCRIPCION_ID = "11111111-1111-4111-8111-111111111111"
USUARIO_ID = "44444444-4444-4444-8444-444444444444"
ORGANIZACION_ID = "55555555-5555-4555-8555-555555555555"

CUERPO_CANONICO = {
    "version": 1,
    "event_id": EVENT_ID,
    "recolector_id": RECOLECTOR_ID,
    "origen": "android",
    "inicio": "2026-11-09T12:00:00Z",
    "fin": "2026-11-09T12:02:00Z",
    "duracion_ms": 30000,
    "tramos_actividad": [
        {"inicio": "2026-11-09T12:00:00Z", "fin": "2026-11-09T12:00:30Z"}
    ],
    "zona_horaria": "America/Santiago",
    "cobertura": "completa",
    "estado": "activo",
}


def _evento_uso(**overrides) -> OutboxEvento:
    datos = datos_uso(
        evento={**CUERPO_CANONICO, **overrides},
        suscripcion_id=SUSCRIPCION_ID,
        usuario_id=USUARIO_ID,
    )
    return OutboxEvento(
        id=uuid.uuid4(),
        organizacion_id=uuid.UUID(ORGANIZACION_ID),
        evento=EVENTO_USO,
        version=VERSION_USO,
        ocurrido_en=timezone.now(),
        correlation_id=uuid.uuid4(),
        datos=datos,
    )


def test_datos_uso_agrega_destino_e_identidad_sin_mutar_el_cuerpo():
    original = dict(CUERPO_CANONICO)

    datos = datos_uso(
        evento=CUERPO_CANONICO,
        suscripcion_id=SUSCRIPCION_ID,
        usuario_id=USUARIO_ID,
    )

    assert datos["suscripcion_id"] == SUSCRIPCION_ID
    assert datos["usuario_id"] == USUARIO_ID
    assert CUERPO_CANONICO == original
    assert "organizacion_id" not in datos


def test_datos_uso_rechaza_campos_de_identidad_en_el_cuerpo():
    for campo in ("organizacion_id", "suscripcion_id", "usuario_id"):
        with pytest.raises(ValueError, match=campo):
            datos_uso(
                evento={**CUERPO_CANONICO, campo: "x"},
                suscripcion_id=SUSCRIPCION_ID,
            )


def test_el_cuerpo_publicado_cumple_el_contrato_canonico():
    datos = datos_uso(
        evento=CUERPO_CANONICO,
        suscripcion_id=SUSCRIPCION_ID,
        usuario_id=USUARIO_ID,
    )
    cuerpo = {
        clave: valor
        for clave, valor in datos.items()
        if clave not in {"suscripcion_id", "usuario_id"}
    }

    VALIDADOR.validate(cuerpo)


def test_iso_utc_recorta_microsegundos_a_tres_decimales():
    """El contrato TypeScript acepta 1–3 decimales; Python emite 6 por defecto."""
    momento = dt.datetime(2026, 11, 9, 12, 2, 1, 123456, tzinfo=dt.timezone.utc)

    assert _iso_utc(momento) == "2026-11-09T12:02:01.123Z"


def test_crear_sobre_uso_usa_event_id_y_version_del_contrato():
    evento = _evento_uso()
    sobre = crear_sobre_uso(evento)

    assert sobre["evento"] == EVENTO_USO
    assert sobre["version"] == VERSION_USO
    assert sobre["id"] == EVENT_ID
    assert sobre["id"] != str(evento.id)
    assert sobre["organizacion_id"] == ORGANIZACION_ID
    assert sobre["correlation_id"] == str(evento.correlation_id)
    assert sobre["datos"]["suscripcion_id"] == SUSCRIPCION_ID
    assert sobre["datos"]["usuario_id"] == USUARIO_ID


@pytest.mark.django_db
def test_registrar_uso_deja_el_evento_en_el_outbox():
    evento = registrar_uso(
        organizacion_id=ORGANIZACION_ID,
        suscripcion_id=SUSCRIPCION_ID,
        usuario_id=USUARIO_ID,
        evento=CUERPO_CANONICO,
    )

    guardado = OutboxEvento.objects.get(pk=evento.pk)
    assert guardado.evento == EVENTO_USO
    assert guardado.version == 1
    assert guardado.organizacion_id == uuid.UUID(ORGANIZACION_ID)
    assert guardado.datos["event_id"] == EVENT_ID
    assert guardado.datos["suscripcion_id"] == SUSCRIPCION_ID


@pytest.mark.django_db
def test_despachador_enruta_uso_al_publicador_dedicado():
    uso = registrar_uso(
        organizacion_id=ORGANIZACION_ID,
        suscripcion_id=SUSCRIPCION_ID,
        evento=CUERPO_CANONICO,
    )
    otro = OutboxEvento.objects.create(
        organizacion_id=uuid.UUID(ORGANIZACION_ID),
        evento="suscripcion.creada",
        version=2,
        correlation_id=uuid.uuid4(),
        datos={"suscripcion_id": SUSCRIPCION_ID},
    )

    with (
        patch("events.despacho.publicar_uso") as publicar_uso,
        patch("events.despacho.publicar") as publicar,
    ):
        assert despachar_pendientes() == {"publicados": 2, "reintentados": 0}

    publicar_uso.assert_called_once()
    assert publicar_uso.call_args.args[0].pk == uso.pk
    publicar.assert_called_once()
    assert publicar.call_args.args[0].pk == otro.pk

    uso.refresh_from_db()
    otro.refresh_from_db()
    assert uso.publicado_en is not None
    assert otro.publicado_en is not None


def test_declarar_uso_coincide_con_la_topologia_del_consumidor():
    canal = MagicMock()

    declarar_uso(canal)

    canal.exchange_declare.assert_any_call(
        exchange=EXCHANGE_USO, exchange_type="topic", durable=True
    )
    canal.exchange_declare.assert_any_call(
        exchange=EXCHANGE_DLX_USO, exchange_type="topic", durable=True
    )
    canal.queue_declare.assert_any_call(
        queue=COLA_FALLOS_USO,
        durable=True,
        arguments={"x-queue-type": "quorum"},
    )
    canal.queue_declare.assert_any_call(
        queue=COLA_USO,
        durable=True,
        arguments={
            "x-queue-type": "quorum",
            "x-dead-letter-exchange": EXCHANGE_DLX_USO,
            "x-dead-letter-routing-key": ROUTING_KEY_USO,
            "x-delivery-limit": 5,
        },
    )
    canal.queue_bind.assert_any_call(
        exchange=EXCHANGE_USO, queue=COLA_USO, routing_key=ROUTING_KEY_USO
    )


def test_publicar_uso_confirma_y_marca_el_mensaje():
    evento = _evento_uso()
    conexion = MagicMock()
    canal = conexion.channel.return_value
    canal.basic_publish.return_value = None  # Contrato real de pika 1.x.

    with patch(
        "events.uso.pika.BlockingConnection", return_value=conexion
    ):
        publicar_uso(evento)

    kwargs = canal.basic_publish.call_args.kwargs
    assert kwargs["exchange"] == EXCHANGE_USO
    assert kwargs["routing_key"] == ROUTING_KEY_USO
    assert kwargs["mandatory"] is True
    assert kwargs["properties"].message_id == EVENT_ID
    assert kwargs["properties"].type == EVENTO_USO
    assert kwargs["properties"].headers == {"version": VERSION_USO}

    sobre = json.loads(kwargs["body"])
    assert sobre["id"] == EVENT_ID
    assert sobre["datos"]["event_id"] == EVENT_ID
    canal.confirm_delivery.assert_called_once()

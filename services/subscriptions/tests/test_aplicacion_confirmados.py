"""FASE 3 — aplicar confirmaciones en Suscripciones, sin tocar RabbitMQ."""

from datetime import date
from decimal import Decimal
import copy
import json
import logging
import uuid

import pytest

from app.models import Cobro, OutboxEvento, Subscription, TrabajoDerivado
from events import confirmaciones
from events.confirmaciones import procesar_confirmacion


def sobre(
    *,
    organizacion_id=None,
    tipo="cobro_realizado",
    crear_cobro=True,
    origen="csv",
    servicio="Netflix",
    importe="9990.00",
    moneda="CLP",
    fecha="2026-01-31",
    **cambios,
):
    """Un sobre válido del productor, con la envoltura común."""
    base = {
        "evento": "candidato.confirmado",
        "version": 1,
        "id": str(uuid.uuid4()),
        "ocurrido_en": "2026-02-01T12:00:00Z",
        "correlation_id": str(uuid.uuid4()),
        "organizacion_id": str(organizacion_id or uuid.uuid4()),
        "datos": {
            "candidato_id": str(uuid.uuid4()),
            "importacion_id": str(uuid.uuid4()),
            "origen": origen,
            "identificador_origen": "sha256:cobro",
            "servicio": servicio,
            "servicio_texto": "NETFLIX.COM",
            "importe": importe,
            "moneda": moneda,
            "fecha": fecha,
            "tipo_mensaje": tipo,
            "crear_cobro": crear_cobro,
            "decidido_por": "42",
            "evidencia": {"fila": "3"},
        },
    }
    base.update(cambios)
    return base


def bytes_de(evento):
    return json.dumps(evento).encode()


def eventos_de(organizacion_id):
    return list(
        OutboxEvento.objects.filter(organizacion_id=organizacion_id).order_by("creado_en", "id")
    )


def crear_suscripcion(organizacion_id, *, nombre="Netflix", monto="5000.00", moneda="CLP",
                      fecha=date(2026, 1, 5)):
    return Subscription.objects.create(
        organizacion_id=organizacion_id,
        nombre=nombre,
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=fecha,
        categoria="streaming",
    )


@pytest.mark.django_db
class TestAplicarConfirmaciones:
    def test_cobro_realizado_crea_suscripcion_cobro_y_evidencia(self):
        evento = sobre()
        resultado = procesar_confirmacion(bytes_de(evento))

        assert resultado.confirmar and resultado.aplicada
        assert resultado.creada and resultado.cobro_creado and resultado.actualizada
        suscripcion = Subscription.objects.get(organizacion_id=evento["organizacion_id"])
        assert suscripcion.nombre == "Netflix"
        assert suscripcion.monto == Decimal("9990.00")
        assert suscripcion.moneda == "CLP"
        assert suscripcion.frecuencia == Subscription.Frecuencia.MENSUAL
        assert suscripcion.categoria == "otro"
        assert suscripcion.fecha_proximo_cobro == date(2026, 2, 28)

        cobro = Cobro.objects.get(organizacion_id=evento["organizacion_id"])
        assert cobro.suscripcion_id == suscripcion.id
        assert cobro.monto == Decimal("9990.00")
        assert cobro.fecha == date(2026, 1, 31)
        assert cobro.origen == Cobro.Origen.CSV
        assert cobro.candidato_id == uuid.UUID(evento["datos"]["candidato_id"])

        emitidos = eventos_de(evento["organizacion_id"])
        assert [e.evento for e in emitidos] == [
            "suscripcion.creada", "suscripcion.actualizada"
        ]
        actualizada = emitidos[-1]
        assert actualizada.datos["campos_modificados"] == ["proximo_cobro"]
        assert actualizada.correlation_id == uuid.UUID(evento["correlation_id"])
        assert TrabajoDerivado.objects.filter(
            evento_id=uuid.UUID(evento["id"]),
            trabajo=TrabajoDerivado.Trabajo.CANDIDATO_APLICADO,
        ).exists()

    def test_aviso_de_cobro_usa_la_fecha_tal_cual_y_no_crea_cobro(self):
        evento = sobre(tipo="aviso_de_cobro", crear_cobro=False, fecha="2026-03-15")
        resultado = procesar_confirmacion(bytes_de(evento))

        assert resultado.confirmar and resultado.aplicada
        assert not resultado.cobro_creado
        suscripcion = Subscription.objects.get(organizacion_id=evento["organizacion_id"])
        assert suscripcion.fecha_proximo_cobro == date(2026, 3, 15)
        assert Cobro.objects.count() == 0
        assert [e.evento for e in eventos_de(evento["organizacion_id"])] == [
            "suscripcion.creada"
        ]

    def test_pago_fallido_no_actualiza_la_fecha_de_una_suscripcion_existente(self):
        suscripcion = crear_suscripcion(uuid.uuid4(), fecha=date(2026, 5, 10))
        evento = sobre(
            organizacion_id=suscripcion.organizacion_id,
            tipo="pago_fallido", crear_cobro=False, fecha="2026-01-01",
        )
        resultado = procesar_confirmacion(bytes_de(evento))

        assert resultado.confirmar and resultado.aplicada
        suscripcion.refresh_from_db()
        assert suscripcion.fecha_proximo_cobro == date(2026, 5, 10)
        assert suscripcion.monto == Decimal("9990.00")  # misma moneda: sí se corrige
        assert Cobro.objects.count() == 0
        assert [e.evento for e in eventos_de(suscripcion.organizacion_id)] == [
            "suscripcion.actualizada"
        ]
        assert eventos_de(suscripcion.organizacion_id)[0].datos["campos_modificados"] == [
            "monto"
        ]

    def test_moneda_distinta_no_sobrescribe_monto_ni_moneda(self):
        suscripcion = crear_suscripcion(uuid.uuid4(), monto="5000.00", moneda="CLP")
        evento = sobre(
            organizacion_id=suscripcion.organizacion_id,
            moneda="USD", importe="10.00", fecha="2026-04-20",
        )
        resultado = procesar_confirmacion(bytes_de(evento))

        assert resultado.confirmar and resultado.cobro_creado
        suscripcion.refresh_from_db()
        assert (suscripcion.monto, suscripcion.moneda) == (Decimal("5000.00"), "CLP")
        assert suscripcion.fecha_proximo_cobro == date(2026, 5, 20)
        assert Cobro.objects.get().moneda == "USD"
        actualizada = eventos_de(suscripcion.organizacion_id)[0]
        assert actualizada.evento == "suscripcion.actualizada"
        assert actualizada.datos["campos_modificados"] == ["proximo_cobro"]

    def test_el_cobro_en_suscripcion_existente_publica_actualizada_sin_cambios(self):
        """El requisito explícito: aunque nada cambiara, hay `actualizada`."""
        suscripcion = crear_suscripcion(uuid.uuid4(), fecha=date(2026, 2, 28))
        evento = sobre(
            organizacion_id=suscripcion.organizacion_id,
            fecha="2026-01-31", importe="5000.00",
        )
        resultado = procesar_confirmacion(bytes_de(evento))

        assert resultado.confirmar and resultado.cobro_creado
        result_fields = [e.evento for e in eventos_de(suscripcion.organizacion_id)]
        assert result_fields == ["suscripcion.actualizada"]
        assert eventos_de(suscripcion.organizacion_id)[0].datos[
            "campos_modificados"
        ] == ["proximo_cobro"]

    def test_crear_cobro_no_se_rededuce_del_tipo(self):
        evento = sobre(tipo="cobro_realizado", crear_cobro=False)
        resultado = procesar_confirmacion(bytes_de(evento))

        assert resultado.confirmar and resultado.aplicada
        assert not resultado.cobro_creado
        assert Cobro.objects.count() == 0
        suscripcion = Subscription.objects.get(organizacion_id=evento["organizacion_id"])
        assert suscripcion.fecha_proximo_cobro == date(2026, 2, 28)

    def test_una_reentrega_no_duplica_suscripcion_cobro_ni_eventos(self):
        evento = sobre()
        primero = procesar_confirmacion(bytes_de(evento))
        segundo = procesar_confirmacion(bytes_de(copy.deepcopy(evento)))

        assert primero.aplicada and not segundo.aplicada
        assert segundo.confirmar and segundo.omitida and segundo.motivo == "ya_aplicada"
        assert Subscription.objects.count() == 1
        assert Cobro.objects.count() == 1
        assert len(eventos_de(evento["organizacion_id"])) == 2
        assert TrabajoDerivado.objects.count() == 1

    def test_otro_evento_con_el_mismo_candidato_no_crea_otro_cobro(self):
        primero = sobre()
        procesar_confirmacion(bytes_de(primero))
        segundo = copy.deepcopy(primero)
        segundo["id"] = str(uuid.uuid4())

        resultado = procesar_confirmacion(bytes_de(segundo))

        assert resultado.confirmar and resultado.omitida
        assert Cobro.objects.count() == 1
        assert TrabajoDerivado.objects.count() == 2  # cada evento queda acreditado

    def test_servicio_normalizado_empareja_suscripcion_existente(self):
        suscripcion = crear_suscripcion(uuid.uuid4(), nombre="Netflix Premium")
        evento = sobre(organizacion_id=suscripcion.organizacion_id, servicio="NETFLIX PREMIUM")
        procesar_confirmacion(bytes_de(evento))

        assert Subscription.objects.count() == 1
        assert Cobro.objects.get().suscripcion_id == suscripcion.id

    def test_cada_tenant_tiene_su_propia_suscripcion(self):
        uno, dos = uuid.uuid4(), uuid.uuid4()
        procesar_confirmacion(bytes_de(sobre(organizacion_id=uno, servicio="Netflix")))
        procesar_confirmacion(bytes_de(sobre(organizacion_id=dos, servicio="Netflix")))

        assert Subscription.objects.count() == 2
        assert Cobro.objects.count() == 2
        assert Subscription.objects.filter(organizacion_id=uno).count() == 1
        assert Subscription.objects.filter(organizacion_id=dos).count() == 1

    @pytest.mark.parametrize(
        "cambio",
        [
            {"version": 2},
            {"evento": "candidato.aplicado"},
            {"datos": {"crear_cobro": "true"}},
        ],
    )
    def test_un_sobre_invalido_va_a_la_cola_de_fallos(self, cambio):
        evento = sobre(**cambio)
        resultado = procesar_confirmacion(bytes_de(evento))

        assert not resultado.confirmar
        assert Subscription.objects.count() == 0 and Cobro.objects.count() == 0

    def test_sin_servicio_resuelto_se_aparta(self):
        resultado = procesar_confirmacion(bytes_de(sobre(servicio=None)))
        assert not resultado.confirmar
        assert "servicio sin resolver" in resultado.motivo

    def test_fuente_no_habilitada_ack_y_log_estructurado(self, settings, caplog):
        settings.CONFIRMACIONES_FUENTES_HABILITADAS = ("csv",)
        evento = sobre(origen="correo")
        with caplog.at_level(logging.INFO, logger=confirmaciones.__name__):
            resultado = procesar_confirmacion(bytes_de(evento))

        assert resultado.confirmar and resultado.omitida
        assert resultado.motivo == "fuente_no_habilitada"
        assert Subscription.objects.count() == 0 and Cobro.objects.count() == 0
        mensaje = caplog.records[-1].getMessage()
        assert f"evento={evento['evento']}" in mensaje
        assert f"candidato={evento['datos']['candidato_id']}" in mensaje
        assert "fuente=correo" in mensaje
        assert "motivo=fuente_no_habilitada" in mensaje
        assert [e.evento for e in eventos_de(evento["organizacion_id"])] == []

    def test_si_falla_el_acreditado_no_queda_medio_cobro(self, monkeypatch):
        evento = sobre()

        def explotar(*_a, **_k):
            raise RuntimeError("no se pudo acreditar")

        monkeypatch.setattr(TrabajoDerivado.objects, "get_or_create", explotar)
        resultado = procesar_confirmacion(bytes_de(evento))

        assert not resultado.confirmar
        assert "no se pudo acreditar" in resultado.motivo
        assert Subscription.objects.count() == 0
        assert Cobro.objects.count() == 0
        assert OutboxEvento.objects.count() == 0
        assert TrabajoDerivado.objects.count() == 0

    def test_no_llama_al_trabajo_derivado_del_post(self):
        import inspect

        fuente = inspect.getsource(confirmaciones)
        assert "al_crear_suscripcion" not in fuente


@pytest.mark.parametrize(
    "fecha, esperada",
    [(date(2026, 1, 31), date(2026, 2, 28)), (date(2026, 12, 15), date(2027, 1, 15))],
)
def test_un_periodo_mensual_nunca_es_la_fecha_del_pago(fecha, esperada):
    assert confirmaciones.fecha_mas_un_mes(fecha) == esperada

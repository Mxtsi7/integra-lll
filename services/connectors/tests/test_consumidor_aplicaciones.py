"""El acuse de vuelta marca el candidato, y solo el acuse lo marca."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import StringIO
import json
import logging
from types import SimpleNamespace
import uuid
from unittest.mock import patch

from django.db.utils import OperationalError
import pytest

from connectors.management.commands import consumir_eventos
from connectors.models import CobroCandidato, Importacion
from events import consumidor
from events.contrato import (
    COLA_APLICACIONES,
    COLA_FALLIDOS_APLICACIONES,
    EXCHANGE,
    EXCHANGE_FALLIDOS_APLICACIONES,
)


class Salida(StringIO):
    """Django cierra su stream al recolectarlo; acá se reutiliza en el test."""

    def close(self):
        pass

    def flush(self):
        pass


class CanalFalso:
    """Canal que entrega lo que se le pone en `mensajes` y registra todo."""

    def __init__(self, mensajes):
        self.mensajes = mensajes
        self.consumos = {}
        self.entregados = []
        self.acks = []
        self.rechazos = []
        self.paradas = 0
        self.declaraciones = []

    def exchange_declare(self, **kw):
        self.declaraciones.append(("exchange", kw))

    def queue_declare(self, **kw):
        self.declaraciones.append(("cola", kw))

    def queue_bind(self, **kw):
        self.declaraciones.append(("enlace", kw))

    def basic_qos(self, **kw):
        self.declaraciones.append(("qos", kw))

    def basic_consume(self, queue, on_message_callback):
        self.consumos[queue] = on_message_callback

    def basic_ack(self, *, delivery_tag):
        self.acks.append(delivery_tag)

    def basic_reject(self, *, delivery_tag, requeue):
        self.rechazos.append((delivery_tag, requeue))

    def stop_consuming(self):
        self.paradas += 1

    def start_consuming(self):
        for cola, cuerpos in self.mensajes.items():
            for cuerpo in [cuerpos] if isinstance(cuerpos, bytes) else cuerpos:
                self.entregados.append(cola)
                self.consumos[cola](
                    self,
                    SimpleNamespace(delivery_tag=len(self.entregados)),
                    None,
                    cuerpo,
                )
                if self.paradas:
                    return

    def close(self):
        self.cerrado = True


def candidato_confirmado():
    org = uuid.uuid4()
    importacion = Importacion.objects.create(
        organizacion_id=org,
        usuario_id=42,
        origen=Importacion.Origen.CSV,
        nombre_archivo="cartola.csv",
    )
    return CobroCandidato.objects.create(
        organizacion_id=org,
        importacion=importacion,
        origen=CobroCandidato.Origen.CSV,
        identificador_origen="sha256:3",
        servicio="Netflix",
        servicio_texto="NETFLIX.COM",
        servicio_resultado="reconocido",
        importe=Decimal("9990.00"),
        moneda="CLP",
        fecha=date(2026, 10, 1),
        tipo_mensaje=CobroCandidato.TipoMensaje.COBRO_REALIZADO,
        estado=CobroCandidato.Estado.CONFIRMADO,
        evidencia={"fila": "3"},
    )


def sobre(candidato, *, aplicada_en=None, **cambios):
    """El sobre que publica Suscripciones desde su outbox."""
    instante = aplicada_en or datetime(2026, 10, 20, 12, 5, tzinfo=timezone.utc)
    base = {
        "evento": "candidato.aplicado",
        "version": 1,
        "id": str(uuid.uuid4()),
        "ocurrido_en": "2026-10-20T12:05:00Z",
        "correlation_id": str(uuid.uuid4()),
        "organizacion_id": str(candidato.organizacion_id),
        "datos": {
            "candidato_id": str(candidato.pk),
            "suscripcion_id": str(uuid.uuid4()),
            "cobro_id": str(uuid.uuid4()),
            "creada": True,
            "cobro_creado": True,
            "aplicada_en": instante.isoformat().replace("+00:00", "Z"),
            "aplicacion": "aplicada",
        },
    }
    base.update(cambios)
    return base


def bytes_de(evento):
    return json.dumps(evento).encode()


def correr(mensajes, *, uno=False):
    """Ejecuta `handle` contra un canal falso, sin broker y sin señales."""
    canal = CanalFalso(mensajes)
    conexion = SimpleNamespace(channel=lambda: canal, close=lambda: None)
    errores = Salida()
    estandar = Salida()
    comando = consumir_eventos.Command(stdout=estandar, stderr=errores)
    with patch.object(
        consumir_eventos.pika, "BlockingConnection", return_value=conexion
    ), patch.object(consumir_eventos.signal, "signal"):
        comando.handle(uno=uno)
    comando.salida_estandar = estandar.getvalue()
    return comando, canal, errores.getvalue()


@pytest.mark.django_db
class TestConsumidor:
    def test_marca_con_la_fecha_del_sobre_no_con_la_del_proceso(self):
        candidato = candidato_confirmado()
        instante = datetime(2026, 10, 20, 12, 5, tzinfo=timezone.utc)

        resultado = consumidor.procesar_aplicacion(
            bytes_de(sobre(candidato, aplicada_en=instante))
        )

        assert (resultado.confirmar, resultado.marcada) == (True, True)
        candidato.refresh_from_db()
        assert candidato.aplicado_en == instante
        assert candidato.actualizado_en == instante

    def test_una_reentrega_no_mueve_la_fecha(self):
        candidato = candidato_confirmado()
        primero = datetime(2026, 10, 20, 12, 5, tzinfo=timezone.utc)
        segundo = primero + timedelta(days=1)

        consumidor.procesar_aplicacion(bytes_de(sobre(candidato, aplicada_en=primero)))
        resultado = consumidor.procesar_aplicacion(
            bytes_de(sobre(candidato, aplicada_en=segundo))
        )

        candidato.refresh_from_db()
        assert candidato.aplicado_en == primero
        assert (resultado.confirmar, resultado.motivo, resultado.omitida) == (
            True, "ya_aplicada", True
        )

    def test_un_sobre_invalito_no_toca_la_base(self):
        candidato = candidato_confirmado()
        evento = sobre(candidato, version=9)

        resultado = consumidor.procesar_aplicacion(bytes_de(evento))

        assert resultado.confirmar is False
        assert "candidato.aplicado v1" in resultado.motivo
        candidato.refresh_from_db()
        assert candidato.aplicado_en is None

    def test_un_candidato_que_no_existe_se_ack_y_queda_rastro(self, caplog):
        candidato = candidato_confirmado()
        otro = uuid.uuid4()
        evento = sobre(candidato, datos=dict(sobre(candidato)["datos"], candidato_id=str(otro)))

        with caplog.at_level(logging.INFO, logger="events.consumidor"):
            resultado = consumidor.procesar_aplicacion(bytes_de(evento))

        assert (resultado.confirmar, resultado.motivo, resultado.omitida) == (
            True, "candidato_inexistente", True
        )
        assert "motivo=candidato_inexistente" in caplog.text
        assert "candidato=%s" % otro in caplog.text

    def test_un_candidato_todavia_propuesto_no_se_afirma_aplicado(self):
        candidato = candidato_confirmado()
        CobroCandidato.objects.filter(pk=candidato.pk).update(
            estado=CobroCandidato.Estado.PROPUESTO
        )

        resultado = consumidor.procesar_aplicacion(bytes_de(sobre(candidato)))

        assert resultado.confirmar is False
        assert "candidato_en_estado_propuesto" == resultado.motivo
        candidato.refresh_from_db()
        assert candidato.aplicado_en is None

    def test_la_base_caida_se_reintenta_y_despues_se_aparta(self):
        candidato = candidato_confirmado()
        esperas = []

        with patch.object(
            consumidor,
            "_marcar",
            side_effect=[
                OperationalError("postgres caido"),
                consumidor.Resultado(True, marcada=True),
            ],
        ) as marcar:
            resultado = consumidor.procesar_aplicacion(
                bytes_de(sobre(candidato)), dormir=esperas.append, avisar=lambda _t: None
            )

        assert (resultado.confirmar, resultado.marcada) == (True, True)
        assert esperas == [1]
        assert marcar.call_count == 2

        esperas.clear()

        def fallar_siempre(*_a, **_k):
            raise OperationalError("postgres caido")

        with patch.object(consumidor, "_marcar", side_effect=fallar_siempre):
            agotado = consumidor.procesar_aplicacion(
                bytes_de(sobre(candidato)), dormir=esperas.append
            )

        assert agotado.confirmar is False
        assert "tras 3 intentos" in agotado.motivo
        assert esperas == [1, 2]

    def test_cobro_id_null_es_valido_porque_no_siempre_hubo_cobro(self):
        candidato = candidato_confirmado()
        evento = sobre(candidato)
        evento["datos"]["cobro_id"] = None
        evento["datos"]["cobro_creado"] = False

        assert consumidor.procesar_aplicacion(bytes_de(evento)).confirmar is True


@pytest.mark.django_db
class TestComando:
    def test_se_suscribe_solo_a_la_cola_del_acuse_y_declara_su_dlq(self):
        comando, canal, _salida = correr({})

        assert set(canal.consumos) == {COLA_APLICACIONES}
        assert any(
            tipo == "exchange" and kw["exchange"] == EXCHANGE
            for tipo, kw in canal.declaraciones
        )
        cola = next(
            kw
            for tipo, kw in canal.declaraciones
            if tipo == "cola" and kw["queue"] == COLA_APLICACIONES
        )
        assert cola["arguments"]["x-dead-letter-exchange"] == (
            EXCHANGE_FALLIDOS_APLICACIONES
        )
        assert any(
            tipo == "cola" and kw["queue"] == COLA_FALLIDOS_APLICACIONES
            for tipo, kw in canal.declaraciones
        )
        assert COLA_APLICACIONES in comando.salida_estandar

    def test_el_ack_viene_despues_de_escribir_la_fecha(self):
        candidato = candidato_confirmado()
        canal = CanalFalso({COLA_APLICACIONES: bytes_de(sobre(candidato))})
        estado = {}
        canal.basic_ack = lambda *, delivery_tag: estado.update(
            aplicado_en=str(
                CobroCandidato.objects.get(pk=candidato.pk).aplicado_en
            ),
            tag=delivery_tag,
        )
        with patch.object(
            consumir_eventos.pika,
            "BlockingConnection",
            return_value=SimpleNamespace(channel=lambda: canal, close=lambda: None),
        ), patch.object(consumir_eventos.signal, "signal"):
            consumir_eventos.Command(stdout=Salida(), stderr=Salida()).handle(uno=True)

        assert estado["tag"] == 1
        assert estado["aplicado_en"] != "None"
        assert canal.rechazos == []

    def test_un_sobre_malo_va_a_la_dlq_y_la_muestra(self):
        candidato = candidato_confirmado()
        evento = sobre(candidato)
        evento["datos"]["aplicacion"] = "pendiente"

        _, canal, salida = correr({COLA_APLICACIONES: bytes_de(evento)})

        assert canal.acks == []
        assert canal.rechazos == [(1, False)]
        assert COLA_FALLIDOS_APLICACIONES in salida
        candidato.refresh_from_db()
        assert candidato.aplicado_en is None

    def test_con_uno_se_detiene_tras_el_primer_mensaje(self):
        """Dos mensajes en la cola; `--uno` no abre el segundo."""
        candidato = candidato_confirmado()
        mensajes = [bytes_de(sobre(candidato)), bytes_de(sobre(candidato))]

        _, canal, _salida = correr({COLA_APLICACIONES: mensajes}, uno=True)

        assert canal.entregados == [COLA_APLICACIONES]
        assert canal.paradas == 1
        assert canal.acks == [1]

    def test_sin_uno_atiende_los_dos_mensajes(self):
        candidato = candidato_confirmado()
        mensajes = [bytes_de(sobre(candidato)), bytes_de(sobre(candidato))]

        _, canal, _salida = correr({COLA_APLICACIONES: mensajes})

        assert canal.entregados == [COLA_APLICACIONES] * 2
        assert canal.acks == [1, 2]

    def test_la_limpieza_no_cierra_la_conexion_de_la_prueba(self):
        """El helper respeta la transacción de `django_db`.

        Con `close_old_connections()` de Django, `autocommit` no coincide con
        `AUTOCOMMIT` y la conexión se cerraba: el ack no podía consultar la
        fecha y la suite de CI veía `KeyError: 'tag'`.
        """
        from django.db import connection

        assert connection.in_atomic_block
        consumir_eventos.close_old_connections()
        assert CobroCandidato.objects.count() == 0

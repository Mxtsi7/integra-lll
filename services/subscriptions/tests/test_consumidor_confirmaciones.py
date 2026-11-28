"""El consumidor atiende DOS colas sin confundir sus fallos ni su --uno."""

from datetime import date
from decimal import Decimal
from io import StringIO
import json
from types import SimpleNamespace
import uuid
from unittest.mock import patch

import pytest

from app.management.commands import consumir_eventos
from app.models import Cobro, OutboxEvento, Subscription, TrabajoDerivado
from events.outbox import registrar_creada
from events.publicador import crear_payload
from events.topologia import (
    COLA_CONFIRMACIONES,
    COLA_FALLIDOS,
    COLA_FALLIDOS_CONFIRMACIONES,
    COLA_RESUMEN,
)
from tests.test_aplicacion_confirmados import sobre as sobre_confirmacion


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
        # El orden de entrega lo decide el test (el broker no garantiza cuál
        # de las dos colas suelta el primer mensaje). --uno corta el ciclo
        # igual que cortaría el loop real de pika.
        for cola, cuerpo in self.mensajes.items():
            self.entregados.append(cola)
            self.consumos[cola](self,
                                SimpleNamespace(delivery_tag=len(self.entregados)),
                                None, cuerpo)
            if self.paradas:
                break

    def close(self):
        self.cerrado = True


def correr(mensajes, *, uno=False):
    """Ejecuta `handle` contra un canal falso, sin broker y sin señales."""
    canal = CanalFalso(mensajes)
    conexion = SimpleNamespace(channel=lambda: canal, close=lambda: None)
    errores = Salida()
    comando = consumir_eventos.Command(stderr=errores)
    with patch.object(consumir_eventos.pika, "BlockingConnection", return_value=conexion), \
         patch.object(consumir_eventos.signal, "signal"):
        comando.handle(uno=uno)
    return comando, canal, errores.getvalue()


def sobre_v2(org):
    suscripcion = Subscription.objects.create(
        organizacion_id=org,
        nombre="Netflix",
        monto=Decimal("9990.00"),
        moneda="CLP",
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria="streaming",
    )
    return json.dumps(crear_payload(registrar_creada(suscripcion))).encode()


@pytest.mark.django_db
class TestDosColas:
    def test_se_suscribe_a_las_dos_y_declara_la_topologia_completa(self):
        _, canal, _salida = correr({})

        assert set(canal.consumos) == {COLA_RESUMEN, COLA_CONFIRMACIONES}
        assert any(tipo == "cola" and kw["queue"] == COLA_RESUMEN
                   for tipo, kw in canal.declaraciones)
        assert any(tipo == "cola" and kw["queue"] == COLA_CONFIRMACIONES
                   for tipo, kw in canal.declaraciones)

    def test_un_sobre_v2_sigue_yendo_a_su_dlq(self):
        _, canal, salida = correr({COLA_RESUMEN: b"no es json"})

        assert canal.entregados == [COLA_RESUMEN]
        assert canal.rechazos == [(1, False)]
        assert COLA_FALLIDOS in salida

    def test_un_sobre_de_confirmacion_invalido_va_a_su_propia_dlq(self):
        evento = sobre_confirmacion()
        evento["version"] = 9
        _, canal, salida = correr({COLA_CONFIRMACIONES: json.dumps(evento).encode()})

        assert canal.entregados == [COLA_CONFIRMACIONES]
        assert canal.rechazos == [(1, False)]
        assert COLA_FALLIDOS_CONFIRMACIONES in salida
        assert Subscription.objects.count() == 0

    def test_ack_de_un_candidato_viene_despues_de_aplicarlo(self):
        """El canal comprueba la base EN el ack: no se confirma antes."""
        evento = sobre_confirmacion()
        canal = CanalFalso({COLA_CONFIRMACIONES: json.dumps(evento).encode()})
        estado = {}
        canal.basic_ack = lambda *, delivery_tag: estado.update(
            cobro=Cobro.objects.count(),
            trabajo=TrabajoDerivado.objects.count(),
            tag=delivery_tag,
        )
        with patch.object(consumir_eventos.pika, "BlockingConnection",
                          return_value=SimpleNamespace(channel=lambda: canal,
                                                       close=lambda: None)), \
             patch.object(consumir_eventos.signal, "signal"):
            consumir_eventos.Command(stdout=Salida(), stderr=Salida()).handle(uno=True)

        assert estado == {"cobro": 1, "trabajo": 1, "tag": 1}
        assert canal.rechazos == []

    def test_un_fallo_a_mitad_no_deja_effects_y_no_confirma(self, monkeypatch):
        evento = sobre_confirmacion()

        def explotar(*_a, **_k):
            raise RuntimeError("base indisponible al acreditar")

        monkeypatch.setattr(TrabajoDerivado.objects, "get_or_create", explotar)
        _, canal, _salida = correr({COLA_CONFIRMACIONES: json.dumps(evento).encode()})

        assert canal.acks == [] and canal.rechazos == [(1, False)]
        assert Subscription.objects.count() == 0
        assert Cobro.objects.count() == 0
        assert OutboxEvento.objects.count() == 0

    @pytest.mark.parametrize("cola", [COLA_RESUMEN, COLA_CONFIRMACIONES])
    def test_con_uno_se_detiene_tras_el_primer_mensaje_de_cualquiera(
        self, cola
    ):
        mensaje = (sobre_v2(uuid.uuid4()) if cola == COLA_RESUMEN
                   else json.dumps(sobre_confirmacion()).encode())
        _, canal, _salida = correr({cola: mensaje,
                                    COLA_RESUMEN: b"no es json",
                                    COLA_CONFIRMACIONES: b"no es json"}, uno=True)

        assert canal.entregados == [cola]
        assert canal.paradas == 1

    def test_la_limpieza_no_cierra_la_conexion_de_la_prueba(self):
        """El helper respeta la transacción de `django_db`.

        Con `close_old_connections()` de Django, la conexión se cerraba y el
        ack no podía contar `Cobro`/`TrabajoDerivado` dentro del canal falso.
        """
        from django.db import connection

        assert connection.in_atomic_block
        consumir_eventos.close_old_connections()
        assert Subscription.objects.count() == 0

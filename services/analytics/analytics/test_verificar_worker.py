"""Healthcheck del consumidor: lee el ``pika.frame.Method`` real.

Regresión: ``queue_declare`` no devuelve una tupla ``(cola, mensajes,
consumidores)``. Devuelve un ``pika.frame.Method`` y el contador está en
``.method.consumer_count``. Desempaquetarlo como tupla lanzaba una excepción y
el contenedor del worker quedaba siempre ``unhealthy``.
"""

from io import StringIO
from unittest.mock import patch

import pika
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from analytics.management.commands.verificar_worker import COLA_ENTRADA


class _CanalFalso:
    def __init__(self, resultado=None, error=None):
        self.resultado = resultado
        self.error = error
        self.declaraciones: list[dict] = []

    def queue_declare(self, **kwargs):
        self.declaraciones.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.resultado


class _ConexionFalsa:
    def __init__(self, canal):
        self._canal = canal
        self.cerrada = False

    def __enter__(self):
        return self

    def __exit__(self, *excepcion):
        self.cerrada = True
        return False

    def channel(self):
        return self._canal


def declaracion(consumidores: int) -> pika.frame.Method:
    """Mismo objeto que devuelve pika al declarar una cola pasiva."""
    return pika.frame.Method(
        1,
        pika.spec.Queue.DeclareOk(
            queue=COLA_ENTRADA,
            message_count=0,
            consumer_count=consumidores,
        ),
    )


@override_settings(RABBITMQ_URL="amqp://guest:guest@rabbitmq:5672/%2F")
class VerificarWorkerTests(SimpleTestCase):
    def ejecutar(self, conexion):
        salida = StringIO()
        with patch("pika.BlockingConnection", return_value=conexion):
            call_command("verificar_worker", stdout=salida)
        return salida.getvalue()

    def test_acepta_un_consumidor_presente(self):
        canal = _CanalFalso(resultado=declaracion(1))
        conexion = _ConexionFalsa(canal)

        salida = self.ejecutar(conexion)

        self.assertEqual(
            canal.declaraciones,
            [{"queue": COLA_ENTRADA, "passive": True}],
        )
        self.assertTrue(conexion.cerrada)
        self.assertIn("1 consumidor(es)", salida)

    def test_falla_si_la_cola_no_tiene_consumidores(self):
        canal = _CanalFalso(resultado=declaracion(0))

        with self.assertRaisesMessage(
            CommandError, "no tiene consumidores activos"
        ):
            self.ejecutar(_ConexionFalsa(canal))

    def test_falla_si_el_broker_no_responde(self):
        with patch(
            "pika.BlockingConnection",
            side_effect=pika.exceptions.AMQPConnectionError("caído"),
        ):
            with self.assertRaisesMessage(CommandError, "RabbitMQ no responde"):
                call_command("verificar_worker", stdout=StringIO())

    def test_falla_si_la_declaracion_es_rechazada(self):
        canal = _CanalFalso(error=pika.exceptions.ChannelClosedByBroker(404, "no existe"))

        with self.assertRaisesMessage(CommandError, "RabbitMQ no responde"):
            self.ejecutar(_ConexionFalsa(canal))

    @override_settings(RABBITMQ_URL="")
    def test_falla_sin_url_configurada(self):
        with patch("pika.BlockingConnection") as conexion:
            with self.assertRaisesMessage(CommandError, "RABBITMQ_URL"):
                call_command("verificar_worker", stdout=StringIO())

        conexion.assert_not_called()

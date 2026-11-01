"""Replay: no perder mensajes al fallar el broker ni recorrer la DLQ sin tope."""
from types import SimpleNamespace
from unittest.mock import Mock

import pika
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from notifications.management.commands.reprocesar_fallidos import reenviar


def canal_con_mensaje():
    canal = Mock()
    canal.queue_declare.return_value.method.message_count = 1
    propiedades = pika.BasicProperties(message_id='evento-1', correlation_id='peticion-1',
                                      content_type='application/json', delivery_mode=2)
    canal.basic_get.return_value = (SimpleNamespace(delivery_tag=7), propiedades, b'{"id":"evento-1"}')
    return canal, propiedades


def test_replay_confirma_publicacion_antes_del_ack_y_conserva_identidad():
    canal, propiedades = canal_con_mensaje()
    orden = []
    def publicar(**kwargs):
        assert kwargs == dict(exchange='', routing_key='notifications.dominio.v2',
                              body=b'{"id":"evento-1"}', properties=propiedades, mandatory=True)
        orden.append('publicacion-confirmada')
    canal.basic_publish.side_effect = publicar
    canal.basic_ack.side_effect = lambda **_: orden.append('ack')
    assert reenviar(canal, 10) == 1
    assert orden == ['publicacion-confirmada', 'ack']


@pytest.mark.parametrize('error', [pika.exceptions.NackError([]), pika.exceptions.UnroutableError([])])
def test_publicacion_fallida_conserva_original_en_dlq(error):
    canal, _ = canal_con_mensaje()
    canal.basic_publish.side_effect = error
    with pytest.raises(type(error)):
        reenviar(canal, 10)
    canal.basic_ack.assert_not_called()
    canal.basic_nack.assert_called_once_with(delivery_tag=7, requeue=True)


def test_replay_respeta_limite_y_no_recorre_mensajes_nuevos():
    canal, _ = canal_con_mensaje()
    canal.queue_declare.return_value.method.message_count = 20
    assert reenviar(canal, 2) == 2
    assert canal.basic_get.call_count == 2
    canal, _ = canal_con_mensaje()
    # Aunque el consumidor vuelva a enviar un inválido a la DLQ, se procesa
    # a lo sumo el número que había al comenzar esta corrida.
    assert reenviar(canal, 100) == 1
    assert canal.basic_get.call_count == 1


@pytest.mark.parametrize('limite', [0, -1])
def test_limite_invalido_falla_antes_de_conectar(limite):
    with pytest.raises(CommandError, match='positivo'):
        call_command('reprocesar_fallidos', limite=limite)

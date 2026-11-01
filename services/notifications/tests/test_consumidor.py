"""FE-24: entrega, commit, rollback, aislamiento y generación en BD."""
import datetime as dt
import json
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from django.db import IntegrityError, connection
from django.db.utils import OperationalError
from django.utils import timezone

from notifications.consumo import recibir
from notifications.management.commands.consumir_eventos import Command
from notifications.models import Alerta, EventoRecibido, SuscripcionVigilada
from notifications.generador import generar
from shared.borrado.models import EstadoOrganizacion
from tests.test_proyeccion import sobre

pytestmark = pytest.mark.django_db(transaction=True)


def cuerpo(**kwargs):
    return json.dumps(sobre(**kwargs)).encode()


def test_reentrega_y_generacion_no_duplican():
    mensaje = cuerpo(proximo_cobro=(timezone.localdate() + dt.timedelta(days=1)).isoformat())
    assert recibir(mensaje)
    assert not recibir(mensaje)
    assert EventoRecibido.objects.count() == 1
    assert SuscripcionVigilada.objects.count() == 1
    assert len(generar().creadas) == 1
    assert generar().creadas == []
    assert Alerta.objects.count() == 1


def test_error_del_efecto_revierte_inbox(monkeypatch):
    from notifications import consumo
    def fallar(_):
        raise IntegrityError('error de otra tabla')
    monkeypatch.setattr(consumo, 'aplicar', fallar)
    with pytest.raises(IntegrityError):
        recibir(cuerpo())
    assert not EventoRecibido.objects.exists()


def test_organizacion_eliminada_no_recrea_inbox_ni_proyeccion():
    org = uuid.uuid4()
    EstadoOrganizacion.objects.create(organizacion_id=org, eliminada=True)
    assert not recibir(cuerpo(org=str(org)))
    assert not EventoRecibido.objects.exists()
    assert not SuscripcionVigilada.objects.exists()
    assert recibir(cuerpo(org=str(uuid.uuid4())))


@pytest.mark.parametrize('invalido', [b'no json', b'[]', b'{}'])
def test_invalido_no_recibe_ack(invalido):
    canal = Mock()
    Command().atender(canal, SimpleNamespace(delivery_tag=7), invalido)
    canal.basic_ack.assert_not_called()
    canal.basic_reject.assert_called_once_with(delivery_tag=7, requeue=False)
    assert not EventoRecibido.objects.exists()


def test_ack_ocurre_despues_del_commit():
    canal = Mock()
    def confirmar(**kwargs):
        assert not connection.in_atomic_block
        assert EventoRecibido.objects.count() == 1
        assert SuscripcionVigilada.objects.count() == 1
    canal.basic_ack.side_effect = confirmar
    Command().atender(canal, SimpleNamespace(delivery_tag=3), cuerpo())
    canal.basic_ack.assert_called_once_with(delivery_tag=3)


def test_error_transitorio_reintenta(monkeypatch):
    import notifications.management.commands.consumir_eventos as comando
    original = comando.recibir
    llamadas = []
    def temporal(mensaje):
        llamadas.append(1)
        if len(llamadas) == 1:
            raise OperationalError('base temporalmente caída')
        return original(mensaje)
    monkeypatch.setattr(comando, 'recibir', temporal)
    monkeypatch.setattr(comando.time, 'sleep', lambda _: None)
    canal = Mock()
    Command().atender(canal, SimpleNamespace(delivery_tag=2), cuerpo())
    assert len(llamadas) == 2
    canal.basic_ack.assert_called_once()
    canal.basic_reject.assert_not_called()


def test_actualizacion_y_cancelacion_v2():
    mensaje = sobre()
    assert recibir(json.dumps(mensaje).encode())
    for nombre, fecha, estado, extra in [
        ('suscripcion.actualizada', '2026-11-02T12:00:00Z', 'activo', {'campos_modificados': ['monto']}),
        ('suscripcion.estado_cambiado', '2026-11-03T12:00:00Z', 'cancelado', {'estado_anterior': 'activo'}),
    ]:
        mensaje.update(id=str(uuid.uuid4()), evento=nombre, ocurrido_en=fecha)
        mensaje['datos'].update(estado=estado, **extra)
        assert recibir(json.dumps(mensaje).encode())
    assert SuscripcionVigilada.objects.get().estado == 'cancelado'


def test_agotamiento_transitorio_rechaza_sin_ack(monkeypatch):
    import notifications.management.commands.consumir_eventos as comando
    fallar = Mock(side_effect=OperationalError('temporal'))
    monkeypatch.setattr(comando, 'recibir', fallar)
    monkeypatch.setattr(comando.time, 'sleep', lambda _: None)
    canal = Mock()
    Command().atender(canal, SimpleNamespace(delivery_tag=2), cuerpo())
    assert fallar.call_count == 3
    canal.basic_ack.assert_not_called()
    canal.basic_reject.assert_called_once_with(delivery_tag=2, requeue=False)


def test_limpieza_real_borra_inbox_y_no_recrea_datos(monkeypatch):
    from tests.test_eliminacion_proyeccion import limpiar, SECRETO
    monkeypatch.setenv('ELIMINACION_INTERNA_SECRET', SECRETO)
    org, otra = uuid.uuid4(), uuid.uuid4()
    mensaje = cuerpo(org=str(org))
    recibir(mensaje)
    recibir(cuerpo(org=str(otra)))
    assert limpiar(org).status_code == 204
    assert not EventoRecibido.objects.filter(organizacion_id=org).exists()
    assert not recibir(mensaje)
    assert EventoRecibido.objects.filter(organizacion_id=otra).count() == 1


def test_fin_prueba_llega_del_evento_y_genera_aviso():
    fecha = (timezone.localdate() + dt.timedelta(days=1)).isoformat()
    recibir(cuerpo(estado='prueba', fin_prueba=fecha))
    assert len([a for a in generar().creadas if a.tipo == 'fin_prueba']) == 1


@pytest.mark.parametrize('anterior,nueva,avisar', [
    ('2026-11-22', '2026-11-30', False),
    ('2026-11-22', None, False),
    ('2026-11-30', '2026-11-22', True),
])
def test_editar_solo_fin_prueba_actualiza_generacion(anterior, nueva, avisar):
    recibir(json.dumps(sobre(estado='prueba', fin_prueba=anterior)).encode())
    actualizado = sobre('suscripcion.actualizada', ocurrido='2026-11-02T12:00:00Z',
                        estado='prueba', fin_prueba=nueva, campos_modificados=['fin_prueba'])
    assert recibir(json.dumps(actualizado).encode())
    vigilada = SuscripcionVigilada.objects.get()
    assert vigilada.fin_prueba == (dt.date.fromisoformat(nueva) if nueva else None)
    ahora = dt.datetime.fromisoformat('2026-11-21T10:00:00-03:00')
    alertas = [a for a in generar(ahora=ahora).creadas if a.tipo == 'fin_prueba']
    assert bool(alertas) is avisar


def test_inbox_de_otro_consumidor_no_suprime_ingesta():
    mensaje = sobre()
    EventoRecibido.objects.create(consumidor='otro', organizacion_id=mensaje['organizacion_id'],
                                 evento_id=mensaje['id'])
    assert recibir(json.dumps(mensaje).encode())
    assert EventoRecibido.objects.count() == 2
    assert SuscripcionVigilada.objects.count() == 1


def test_rechazo_registra_ids_y_regla_sin_valores():
    from io import StringIO
    import pika
    salida = StringIO()
    message_id, correlacion = str(uuid.uuid4()), str(uuid.uuid4())
    propiedades = pika.BasicProperties(message_id=message_id, correlation_id=correlacion)
    Command(stderr=salida).atender(Mock(), SimpleNamespace(delivery_tag=9),
                                 cuerpo(fin_prueba='secreto-no-loguear'), propiedades)
    log = salida.getvalue()
    assert message_id in log and correlacion in log
    assert 'format' in log
    assert 'secreto-no-loguear' not in log

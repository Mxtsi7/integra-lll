"""PoC MX-21; efectos sintéticos en SQLite, sin conectar servicios de dominio."""
import argparse
import copy
from contextlib import closing
from datetime import datetime
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
from uuid import uuid4

from jsonschema import Draft202012Validator, FormatChecker, ValidationError
import pika

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = json.loads((RAIZ / 'shared/events/mx21-v2.schema.json').read_text('utf-8'))
Draft202012Validator.check_schema(ESQUEMA)
VALIDADOR = Draft202012Validator(ESQUEMA, format_checker=FormatChecker())


def ejemplos():
    base = dict(version=2, ocurrido_en='2026-10-20T12:00:00Z',
                correlation_id=str(uuid4()), organizacion_id=str(uuid4()))
    snapshot = dict(suscripcion_id=str(uuid4()), proveedor_id=None, nombre='Demo MX-21',
                    monto='9990.00', moneda='CLP', ciclo='mensual',
                    proximo_cobro='2026-10-25', estado='activo')
    cargas = {
        'suscripcion.creada': snapshot,
        'suscripcion.actualizada': dict(snapshot, moneda='EUR', campos_modificados=['moneda']),
        'suscripcion.estado_cambiado': dict(snapshot, estado_anterior='prueba', evento_estado='fin_prueba'),
        'alerta.activada': dict(alerta_id=str(uuid4()), suscripcion_id=snapshot['suscripcion_id'],
                               usuario_id=42, tipo='proximo_cobro',
                               programada_para='2026-10-20T12:00:00Z'),
    }
    return [dict(base, id=str(uuid4()), evento=nombre, datos=datos)
            for nombre, datos in cargas.items()]


def aplicar(db, evento, clave, propiedades):
    VALIDADOR.validate(evento)
    if (clave != f"{evento['evento']}.v{evento['version']}" or propiedades.message_id != evento['id']
            or propiedades.correlation_id != evento['correlation_id']
            or propiedades.content_type != 'application/json'):
        raise ValueError('Metadatos AMQP incompatibles con la envoltura')
    datos = evento['datos']
    if evento['evento'] == 'suscripcion.estado_cambiado' and datos['estado'] == datos['estado_anterior']:
        raise ValueError('El estado debe cambiar')
    if (evento['evento'] == 'alerta.activada'
            and datetime.fromisoformat(datos['programada_para']) > datetime.fromisoformat(evento['ocurrido_en'])):
        raise ValueError('La alerta todavía no alcanza su instante programado')
    # Cada entrega abre otra conexión: la deduplicación sobrevive al reinicio.
    with closing(sqlite3.connect(db)) as conexion, conexion:
        conexion.execute('CREATE TABLE IF NOT EXISTS inbox (tenant TEXT, id TEXT, PRIMARY KEY(tenant,id))')
        conexion.execute('CREATE TABLE IF NOT EXISTS efectos (tenant TEXT, id TEXT)')
        nuevo = conexion.execute('INSERT OR IGNORE INTO inbox VALUES (?,?)',
                                 (evento['organizacion_id'], evento['id'])).rowcount
        if nuevo:
            conexion.execute('INSERT INTO efectos VALUES (?,?)', (evento['organizacion_id'], evento['id']))
    return bool(nuevo)


def recibir(canal, cola):
    limite = time.monotonic() + 5
    while time.monotonic() < limite:
        entrega, propiedades, cuerpo = canal.basic_get(cola, auto_ack=False)
        if entrega:
            return entrega, propiedades, cuerpo
        time.sleep(0.05)
    raise RuntimeError('No se recibió el mensaje en 5 segundos')


def comprobar(db, canal=None, cola=None, fallos=None):
    validos = ejemplos()
    otro_tenant = dict(validos[0], organizacion_id=str(uuid4()))
    invalidos = []
    for campo, valor in [('organizacion_id', None), ('organizacion_id', ''),
                         ('correlation_id', 'invalido'), ('version', 3),
                         ('evento', 'subscription.created'), ('datos', {})]:
        copia = copy.deepcopy(validos[0])
        if valor is None:
            del copia[campo]
        else:
            copia[campo] = valor
        invalidos.append(copia)
    invalidos += [dict(validos[0], datos=dict(validos[0]['datos'], monto='-1.00'))]
    for original, cambios in [
        (validos[3], {'usuario_id': str(uuid4())}),
        (validos[3], {'usuario_id': 0}),
        (validos[3], {'usuario_id': '42'}),
        (validos[0], {'moneda': 'eur'}),
        (validos[2], {'evento_estado': 'inexistente'}),
        (validos[2], {'estado_anterior': 'activo'}),
    ]:
        invalidos.append(dict(original, datos=dict(original['datos'], **cambios)))
    casos = [(e, True) for e in validos] + [(validos[0], False), (otro_tenant, True)]
    casos += [(e, None) for e in invalidos]
    for indice, (evento, esperado) in enumerate(casos):
        clave = evento['evento'] + '.v2'
        propiedades = pika.BasicProperties(message_id=evento['id'], delivery_mode=2,
                        correlation_id=evento['correlation_id'], content_type='application/json')
        cuerpo = json.dumps(evento).encode('utf-8')
        if canal:
            canal.basic_publish('suscripciones', clave, cuerpo, propiedades, mandatory=True)
            entrega, propiedades, cuerpo = recibir(canal, cola)
            clave = entrega.routing_key
        try:
            resultado = aplicar(db, json.loads(cuerpo), clave, propiedades)
        except (ValidationError, ValueError) as error:
            assert esperado is None, str(error)
            if canal:
                canal.basic_reject(entrega.delivery_tag, requeue=False)
                rechazo, cabeceras, rechazado = recibir(canal, fallos)
                assert rechazado == cuerpo and cabeceras.headers['x-death'][0]['reason'] == 'rejected'
                canal.basic_ack(rechazo.delivery_tag)
            print(f'RECHAZADO {indice + 1}: {evento["evento"]}')
        else:
            assert esperado is not None and resultado == esperado
            if canal:
                if indice == 0:  # Commit realizado; se pierde el ack y vuelve la entrega.
                    canal.basic_nack(entrega.delivery_tag, requeue=True)
                    entrega, propiedades, cuerpo = recibir(canal, cola)
                    assert entrega.redelivered
                    assert not aplicar(db, json.loads(cuerpo), entrega.routing_key, propiedades)
                    print('REENTREGA: efecto persistido no se repite al reabrir SQLite')
                canal.basic_ack(entrega.delivery_tag)
            print(f'{"APLICADO" if resultado else "DUPLICADO"} {indice + 1}: {evento["evento"]}')
    with closing(sqlite3.connect(db)) as conexion:
        assert conexion.execute('SELECT COUNT(*) FROM efectos').fetchone()[0] == 5
    print(f'OK: 4 contratos; 5 efectos (2 tenants); 1 duplicado; {len(invalidos)} rechazos')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sin-broker', action='store_true', help='Solo contrato y SQLite; NO prueba AMQP')
    parser.add_argument('--ejemplos', action='store_true', help='Imprime los cuatro mensajes JSON completos')
    args = parser.parse_args()
    if args.ejemplos:
        print(json.dumps(ejemplos(), indent=2, ensure_ascii=False))
        return
    with tempfile.TemporaryDirectory() as temporal:
        db = str(Path(temporal) / 'efectos.sqlite3')
        if args.sin_broker:
            comprobar(db)
            return
        parametros = pika.URLParameters(os.environ['RABBITMQ_URL'])
        parametros.socket_timeout = 5
        parametros.blocked_connection_timeout = 10
        with pika.BlockingConnection(parametros) as conexion:
            canal = conexion.channel()
            canal.exchange_declare('suscripciones', exchange_type='topic', durable=True)
            cola = 'mx21.' + str(uuid4())
            fallos = cola + '.fallos'
            canal.queue_declare(fallos, durable=True)
            canal.queue_declare(cola, durable=True, arguments={
                'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': fallos})
            try:
                # Incluye el alias inválido únicamente para verificar su rechazo.
                for clave in [e['evento'] for e in ejemplos()] + ['subscription.created']:
                    canal.queue_bind(cola, 'suscripciones', clave + '.v2')
                canal.basic_qos(prefetch_count=1)
                canal.confirm_delivery()
                comprobar(db, canal, cola, fallos)
                assert canal.queue_declare(cola, passive=True).method.message_count == 0
                assert canal.queue_declare(fallos, passive=True).method.message_count == 0
            finally:
                canal.queue_delete(cola)
                canal.queue_delete(fallos)


if __name__ == '__main__':
    main()


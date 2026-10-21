"""Regresiones del contrato MX-21; no sustituyen al productor real de VI-26."""
import copy
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from uuid import uuid4

import pika
from jsonschema import ValidationError

from intercambio import VALIDADOR, aplicar, ejemplos


class ContratoTests(unittest.TestCase):
    def setUp(self):
        self.mensajes = ejemplos()

    def test_usuario_id_entero_de_auth(self):
        for usuario_id in (1, 42, 9223372036854775807):
            with self.subTest(usuario_id=usuario_id):
                evento = copy.deepcopy(self.mensajes[3])
                evento['datos']['usuario_id'] = usuario_id
                VALIDADOR.validate(evento)

    def test_usuario_id_incompatible_se_rechaza(self):
        for usuario_id in (str(uuid4()), '42', 0, -1, 1.5, True, None, 9223372036854775808):
            with self.subTest(usuario_id=usuario_id):
                evento = copy.deepcopy(self.mensajes[3])
                evento['datos']['usuario_id'] = usuario_id
                with self.assertRaises(ValidationError):
                    VALIDADOR.validate(evento)

    def test_moneda_abierta_en_los_tres_eventos_de_suscripcion(self):
        for original in self.mensajes[:3]:
            for moneda in ('CLP', 'USD', 'EUR', 'BRL', 'JPY'):
                with self.subTest(evento=original['evento'], moneda=moneda):
                    evento = copy.deepcopy(original)
                    evento['datos']['moneda'] = moneda
                    VALIDADOR.validate(evento)

    def test_formato_invalido_de_moneda_se_rechaza(self):
        for moneda in ('eur', 'EU', 'EURO', 'E1R', 'EUR\n', '', None, 123):
            with self.subTest(moneda=moneda):
                evento = copy.deepcopy(self.mensajes[0])
                evento['datos']['moneda'] = moneda
                with self.assertRaises(ValidationError):
                    VALIDADOR.validate(evento)

    def test_transicion_admite_causa_y_mensajes_previos_sin_ella(self):
        evento = copy.deepcopy(self.mensajes[2])
        VALIDADOR.validate(evento)
        evento['datos'].update(estado_anterior='activo', estado='cancelado',
                               evento_estado='cancelacion_usuario')
        VALIDADOR.validate(evento)
        del evento['datos']['evento_estado']
        VALIDADOR.validate(evento)

    def test_causa_invalida_no_produce_efecto(self):
        with tempfile.TemporaryDirectory() as temporal:
            db = str(Path(temporal) / 'efectos.sqlite3')
            evento = copy.deepcopy(self.mensajes[2])
            propiedades = pika.BasicProperties(message_id=evento['id'],
                correlation_id=evento['correlation_id'], content_type='application/json')
            clave = evento['evento'] + '.v2'
            self.assertTrue(aplicar(db, evento, clave, propiedades))
            evento['id'] = propiedades.message_id = str(uuid4())
            for causa in ('inexistente', '', None):
                with self.subTest(causa=causa), self.assertRaises(ValidationError):
                    evento['datos']['evento_estado'] = causa
                    aplicar(db, evento, clave, propiedades)
            with closing(sqlite3.connect(db)) as conexion:
                self.assertEqual(conexion.execute('SELECT COUNT(*) FROM efectos').fetchone()[0], 1)
                self.assertEqual(conexion.execute('SELECT COUNT(*) FROM inbox').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()

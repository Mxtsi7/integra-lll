"""El nuevo contrato v1 convive con MX-21 v2 sin tocar sus cuatro eventos."""
import copy
import tempfile
import unittest
from uuid import uuid4

import pika
from jsonschema import ValidationError

from intercambio import VALIDADOR, VALIDADOR_CANDIDATO, aplicar, ejemplos, validar


def mensaje():
    return {
        'evento': 'candidato.confirmado',
        'version': 1,
        'id': str(uuid4()),
        'ocurrido_en': '2026-10-20T12:00:00Z',
        'correlation_id': str(uuid4()),
        'organizacion_id': str(uuid4()),
        'datos': {
            'candidato_id': str(uuid4()),
            'importacion_id': str(uuid4()),
            'origen': 'csv',
            'identificador_origen': 'sha256:3',
            'servicio': 'Netflix',
            'servicio_texto': 'NETFLIX.COM',
            'importe': '9990.00',
            'moneda': 'CLP',
            'fecha': '2026-10-01',
            'tipo_mensaje': 'cobro_realizado',
            'crear_cobro': True,
            'decidido_por': '42',
            'evidencia': {'fila': '3'},
        },
    }


class CandidatoConfirmadoV1Tests(unittest.TestCase):
    def test_envoltura_valida_y_v2_no_la_acepta(self):
        evento = mensaje()
        validar(evento)
        VALIDADOR_CANDIDATO.validate(evento)
        with self.assertRaises(ValidationError):
            VALIDADOR.validate(evento)

    def test_los_cuatro_eventos_v2_sigen_validando(self):
        for evento in ejemplos():
            validar(evento)

    def test_rechaza_version_desconocida_y_campos_clave(self):
        base = mensaje()
        for cambio in ({'version': 2}, {'evento': 'candidato.aplicado'},
                       {'organizacion_id': 'no-uuid'},
                       {'datos': dict(base['datos'], crear_cobro='true')},
                       {'datos': dict(base['datos'], tipo_mensaje='otro')}):
            with self.subTest(cambio=cambio), self.assertRaises(ValidationError):
                validar(dict(base, **cambio))
        sin_org = copy.deepcopy(base)
        del sin_org['organizacion_id']
        with self.assertRaises(ValidationError):
            validar(sin_org)

    def test_aplicar_es_idempotente_con_la_envoltura_v1(self):
        evento = mensaje()
        propiedades = pika.BasicProperties(
            message_id=evento['id'], correlation_id=evento['correlation_id'],
            content_type='application/json')
        clave = 'candidato.confirmado.v1'
        with tempfile.TemporaryDirectory() as temporal:
            db = str(temporal + '/efectos.sqlite3')
            self.assertTrue(aplicar(db, evento, clave, propiedades))
            self.assertFalse(aplicar(db, copy.deepcopy(evento), clave, propiedades))


if __name__ == '__main__':
    unittest.main()

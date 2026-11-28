"""El acuse de vuelta también usa la envoltura común, sin tocar MX-21 v2."""
import copy
import tempfile
import unittest
from uuid import uuid4

import pika
from jsonschema import ValidationError

from intercambio import VALIDADOR, VALIDADOR_APLICADO, aplicar, ejemplos, validar


def mensaje():
    return {
        'evento': 'candidato.aplicado',
        'version': 1,
        'id': str(uuid4()),
        'ocurrido_en': '2026-10-20T12:05:00Z',
        'correlation_id': str(uuid4()),
        'organizacion_id': str(uuid4()),
        'datos': {
            'candidato_id': str(uuid4()),
            'suscripcion_id': str(uuid4()),
            'cobro_id': str(uuid4()),
            'creada': True,
            'cobro_creado': True,
            'aplicada_en': '2026-10-20T12:05:00Z',
            'aplicacion': 'aplicada',
        },
    }


class CandidatoAplicadoV1Tests(unittest.TestCase):
    def test_envoltura_valida_y_v2_no_la_acepta(self):
        evento = mensaje()
        validar(evento)
        VALIDADOR_APLICADO.validate(evento)
        with self.assertRaises(ValidationError):
            VALIDADOR.validate(evento)

    def test_los_cuatro_eventos_v2_sigen_validando(self):
        for evento in ejemplos():
            validar(evento)

    def test_rechaza_version_campos_y_el_valor_de_aplicacion(self):
        base = mensaje()
        for cambio in (
            {'version': 2},
            {'evento': 'candidato.confirmado'},
            {'organizacion_id': 'no-uuid'},
            {'datos': dict(base['datos'], aplicacion='pendiente')},
            {'datos': dict(base['datos'], cobro_id='')},
            {'datos': dict(base['datos'], aplicada_en='2026-10-20')},
        ):
            with self.subTest(cambio=cambio), self.assertRaises(ValidationError):
                validar(dict(base, **cambio))
        sin_candidato = copy.deepcopy(base)
        del sin_candidato['datos']['candidato_id']
        with self.assertRaises(ValidationError):
            validar(sin_candidato)

    def test_cobro_id_puede_ser_null_cuando_no_hubo_cobro(self):
        base = mensaje()
        base['datos']['cobro_id'] = None
        base['datos']['cobro_creado'] = False
        validar(base)

    def test_aplicar_es_idempotente_con_la_envoltura_v1(self):
        evento = mensaje()
        propiedades = pika.BasicProperties(
            message_id=evento['id'], correlation_id=evento['correlation_id'],
            content_type='application/json')
        clave = 'candidato.aplicado.v1'
        with tempfile.TemporaryDirectory() as temporal:
            db = str(temporal + '/efectos.sqlite3')
            self.assertTrue(aplicar(db, evento, clave, propiedades))
            self.assertFalse(aplicar(db, copy.deepcopy(evento), clave, propiedades))


if __name__ == '__main__':
    unittest.main()

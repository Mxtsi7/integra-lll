"""Respaldo durable y recuperación con un API server doble con estado."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

RUTA = Path(__file__).resolve().parents[2] / 'k8s/pruebas/estado_comparador.py'


def cargar():
    spec = importlib.util.spec_from_file_location('estado_comparador', RUTA)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


class API:
    def __init__(self):
        self.llamadas, self.fallar = [], None
        self.api = dict(metadata=dict(name='subscriptions', uid='11111111-1111-4111-a111-111111111111',
                         resourceVersion='1', annotations={'otra': 'conservar'}),
                        spec={'template': {'spec': {'containers': [{'name': 'subscriptions', 'env': []}]}}})
        self.hpa = dict(metadata=dict(name='gateway', uid='22222222-2222-4222-a222-222222222222'),
                        spec=dict(minReplicas=1, maxReplicas=2, scaleTargetRef={'name': 'gateway'}))

    def __call__(self, *args):
        self.llamadas.append(args)
        if self.fallar and self.fallar in args:
            raise RuntimeError('fallo simulado')
        if args[:2] == ('get', 'deployment/subscriptions'):
            return json.dumps(self.api)
        if args[:2] == ('get', 'hpa/gateway'):
            return json.dumps(self.hpa)
        if args[0] == 'rollout':
            return ''
        if args[:2] == ('set', 'env'):
            self.api['spec']['template']['spec']['containers'][0]['env'] = []
            return ''
        if args[:2] == ('patch', 'hpa'):
            self.hpa['spec'].update(json.loads(args[-1])['spec'])
            return ''
        if args[:2] == ('patch', 'deployment/subscriptions'):
            p = json.loads(args[-1])
            if isinstance(p, list):
                for op in p:
                    if op['op'] == 'test':
                        continue
                    if op['path'] == '/metadata/annotations':
                        self.api['metadata']['annotations'] = op['value']
                    else:
                        key = op['path'].split('/')[-1].replace('~1', '/').replace('~0', '~')
                        if op['op'] == 'remove':
                            self.api['metadata']['annotations'].pop(key)
                        else:
                            self.api['metadata']['annotations'][key] = op['value']
            else:
                env = p['spec']['template']['spec']['containers'][0]['env'][0]
                self.api['spec']['template']['spec']['containers'][0]['env'] = [
                    {k: v for k, v in env.items() if v is not None}]
            return ''
        raise AssertionError(args)


class EstadoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = cargar()

    def test_corte_y_segundo_proceso_recuperan_original_sin_tokens(self):
        api = API()
        estado = self.m.EstadoComparador(api)
        estado.guardar(copy.deepcopy(api.api), [copy.deepcopy(api.hpa)])
        self.assertEqual(api.llamadas[0][0], 'patch')
        self.assertIn(self.m.ANOTACION, api.api['metadata']['annotations'])
        # SIGKILL: se pierde el primer objeto Python después de cambiar configuración.
        api.hpa['spec'].update(minReplicas=1, maxReplicas=1)
        api.api['spec']['template']['spec']['containers'][0]['env'] = [{'name': 'EVENTOS_ASINCRONOS', 'value': '1'}]
        nuevo = self.m.EstadoComparador(api)
        with self.assertRaisesRegex(RuntimeError, 'restaurar'):
            nuevo.comprobar_limpio(api.api)
        self.assertTrue(nuevo.cargar())
        nuevo.restaurar()
        self.assertEqual(api.hpa['spec']['maxReplicas'], 2)
        self.assertEqual(api.api['spec']['template']['spec']['containers'][0]['env'], [])
        self.assertEqual(api.api['metadata']['annotations'], {'otra': 'conservar'})

    def test_restauracion_fallida_conserva_marca_y_ofrece_comandos_exactos(self):
        api = API()
        estado = self.m.EstadoComparador(api)
        estado.guardar(copy.deepcopy(api.api), [copy.deepcopy(api.hpa)])
        api.fallar = 'hpa'
        with self.assertRaisesRegex(RuntimeError, 'restaurar'):
            estado.restaurar()
        self.assertIn(self.m.ANOTACION, api.api['metadata']['annotations'])
        comandos = estado.comandos(['kubectl', '--context', 'equipo', '-n', 'prueba'])
        self.assertIn('maxReplicas', '\n'.join(comandos))
        self.assertIn('EVENTOS_ASINCRONOS-', '\n'.join(comandos))
        api.fallar = None
        recuperado = self.m.EstadoComparador(api)
        recuperado.cargar()
        recuperado.restaurar()
        self.assertNotIn(self.m.ANOTACION, api.api['metadata']['annotations'])

    def test_env_literal_y_valuefrom_se_recuperan_exactos(self):
        for original in ({'name': 'EVENTOS_ASINCRONOS', 'value': '0'},
                         {'name': 'EVENTOS_ASINCRONOS', 'valueFrom': {'configMapKeyRef': {'name': 'ojoalgasto', 'key': 'EVENTOS_ASINCRONOS'}}}):
            with self.subTest(original=original):
                api = API()
                api.api['spec']['template']['spec']['containers'][0]['env'] = [original]
                estado = self.m.EstadoComparador(api)
                estado.guardar(copy.deepcopy(api.api), [copy.deepcopy(api.hpa)])
                api.api['spec']['template']['spec']['containers'][0]['env'] = [{'name': 'EVENTOS_ASINCRONOS', 'value': '1'}]
                estado.restaurar()
                self.assertEqual(api.api['spec']['template']['spec']['containers'][0]['env'], [original])

    def test_marca_corrupta_o_uid_distinto_no_autorizan_restaurar(self):
        api = API()
        estado = self.m.EstadoComparador(api)
        estado.guardar(copy.deepcopy(api.api), [copy.deepcopy(api.hpa)])
        api.api['metadata']['uid'] = '33333333-3333-4333-a333-333333333333'
        nuevo = self.m.EstadoComparador(api)
        with self.assertRaises(RuntimeError):
            nuevo.cargar()
        api.api['metadata']['annotations'][self.m.ANOTACION] = '{mal}'
        with self.assertRaises(RuntimeError):
            nuevo.cargar()


if __name__ == '__main__':
    unittest.main()

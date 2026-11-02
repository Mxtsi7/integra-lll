"""Snapshot en vivo y autoscaling del comparador: sin cluster ni navegador."""
import importlib.util
import io
import itertools
import json
from datetime import datetime
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

PRUEBAS = Path(__file__).resolve().parents[2] / 'k8s/pruebas'
sys.path.insert(0, str(PRUEBAS))


def cargar(nombre):
    spec = importlib.util.spec_from_file_location(nombre, PRUEBAS / f'{nombre}.py')
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


s = cargar('snapshot_comparador')
m = cargar('comparar_tiempos')
TOKENS = ['aaa.bbb.ccc-secreto-sin', 'ddd.eee.fff-secreto-con']


def hpa(nombre, cpu='35m', actuales=1, deseadas=1, minimo=1, maximo=2):
    return dict(metadata={'name': nombre}, spec=dict(
        scaleTargetRef={'name': nombre}, minReplicas=minimo, maxReplicas=maximo,
        metrics=[dict(type='Resource', resource=dict(name='cpu', target=dict(type='AverageValue', averageValue='120m')))]),
        status=dict(currentReplicas=actuales, desiredReplicas=deseadas, currentMetrics=None if cpu is None else [
            dict(type='Resource', resource=dict(name='cpu', current=dict(averageValue=cpu)))]))


def cfg(**cambios):
    base = dict(url='https://ojo.ejemplo.cl/api/suscripciones/', tokens=TOKENS, operaciones=2,
                repeticiones=2, conexiones=1, semilla=10, espera=5, calentamiento=0, autoescalado='fijo')
    return {**base, **cambios}


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.dir = Path(temporal.name)
        control = patch.object(m, 'validar_vigencia')
        control.start()
        self.addCleanup(control.stop)

    def registro(self, config, muestrear):
        reloj = itertools.count(0, 1.5)
        return s.Registro(config, muestrear=muestrear, directorio=self.dir, abrir=False, intervalo=3600,
                          reloj=lambda: next(reloj), ahora=lambda: datetime(2026, 11, 2, 15, 30, 0))

    def test_cantidades_de_cpu_de_kubernetes(self):
        for cantidad, esperado in (('35m', 35), ('1', 1000), ('1500000n', 1.5), ('250u', 0.25),
                                   (None, None), ('abc', None), ('-5m', None), ('inf', None)):
            with self.subTest(cantidad=cantidad):
                self.assertEqual(s.milicores(cantidad), esperado)

    def test_formula_del_hpa_con_tolerancia_y_limites(self):
        self.assertEqual(s.estimar_replicas(1, 300, 120, 1, 2), 2)    # pediría 3, el máximo es 2
        self.assertEqual(s.estimar_replicas(1, 125, 120, 1, 2), 1)    # dentro del 10 %: no cambia
        self.assertEqual(s.estimar_replicas(1, 140, 120, 1, 2), 2)
        self.assertEqual(s.estimar_replicas(2, 30, 120, 1, 2), 1)
        self.assertIsNone(s.estimar_replicas(1, None, 120, 1, 2))

    def test_lee_cpu_objetivo_y_replicas_del_hpa(self):
        lectura = s.leer_hpa(hpa('subscriptions', cpu='180m', actuales=1, deseadas=2))
        self.assertEqual(lectura, dict(minimo=1, maximo=2, objetivo_m=120, cpu_m=180, actuales=1, deseadas=2))
        self.assertIsNone(s.leer_hpa(hpa('gateway', cpu=None))['cpu_m'])

    def test_en_vivo_se_recarga_y_al_terminar_queda_fijo_sin_tokens(self):
        muestras = iter([json.dumps({'items': [hpa('gateway'), hpa('subscriptions', cpu='150m')]})] * 50)
        registro = self.registro(cfg(), lambda: next(muestras))
        cluster = Mock()
        cluster.organizaciones.return_value = ['11111111-1111-4111-a111-111111111111',
                                               '22222222-2222-4222-a222-222222222222']
        cluster.hpas_originales = {n: s.leer_hpa(hpa(n)) for n in ('gateway', 'subscriptions')}
        cluster.esperar.return_value = dict(lote_s=3.5, outbox_ms=[900.0, 1200.0], posterior_ms=[5.0, -1.0], solapados=1)
        cluster.verificar.return_value = {'gateway': 1, 'subscriptions': 1}
        vistas = []
        cluster.sembrar.side_effect = lambda *_: vistas.append(registro.html.read_text(encoding='utf-8'))
        with patch('sys.stdout', io.StringIO()) as salida:
            resultados = m.comparar(cfg(), cluster, Mock(return_value=[(201, 40.0), (201, 60.0)]), registro)
            registro.terminar(resultados)
        self.assertIn('http-equiv="refresh"', vistas[0])
        self.assertIn('En curso', vistas[0])
        final = registro.html.read_text(encoding='utf-8')
        datos = json.loads(registro.json.read_text(encoding='utf-8'))
        self.assertNotIn('http-equiv="refresh"', final)
        self.assertIn('Terminada', final)
        self.assertEqual(datos['estado'], 'terminada')
        self.assertEqual([(r['ronda'], r['modo']) for r in datos['rondas']], [(1, 0), (1, 1), (2, 1), (2, 0)])
        self.assertEqual({f['tipo'] for f in datos['fases']}, {'reinicio', 'http'})
        self.assertEqual(datos['resumen']['solapados'], 2)
        # 150m con objetivo 120m y 1 réplica: el HPA fijo habría pedido 2.
        self.assertEqual(datos['muestras'][-1]['hpas']['subscriptions']['pide'], 2)
        self.assertTrue(datos['muestras'][-1]['final'])
        for texto in (final, registro.json.read_text(encoding='utf-8')):
            for secreto in TOKENS + cluster.organizaciones.return_value:
                self.assertNotIn(secreto, texto)
        self.assertEqual(list(self.dir.glob('*.tmp')), [])
        terminal = salida.getvalue()
        self.assertIn('Parcial tras la ronda 1/2', terminal)
        self.assertIn('HPA subscriptions: 1 réplica(s) · CPU 150m de 120m · pediría 2', terminal)

    def test_comparacion_fallida_queda_marcada_como_invalida(self):
        registro = self.registro(cfg(), Mock(side_effect=RuntimeError('Falló kubectl')))
        cluster = Mock()
        cluster.organizaciones.return_value = ['a', 'b']
        with patch('sys.stdout', io.StringIO()), self.assertRaises(RuntimeError):
            try:
                m.comparar(cfg(), cluster, Mock(return_value=[(401, 5.0)]), registro)
            except RuntimeError as error:
                registro.terminar(error=error)
                raise
        cluster.restaurar.assert_called_once()
        final = registro.html.read_text(encoding='utf-8')
        self.assertIn('Comparación inválida', final)
        self.assertIn('401', final)
        self.assertNotIn('http-equiv="refresh"', final)
        self.assertIn('No se pudo leer el HPA', final)  # El muestreo falló: hueco, no excepción.

    def test_sin_iniciar_no_escribe_nada(self):
        registro = self.registro(cfg(), None)
        self.assertIsNone(registro.terminar(error=ValueError('Usar dos organizaciones')))
        self.assertEqual(list(self.dir.iterdir()), [])

    def test_html_escapa_el_error(self):
        registro = self.registro(cfg(), None)
        registro.iniciar()
        registro.terminar(error=RuntimeError('<script>alert(1)</script>'))
        self.assertNotIn('<script>', registro.html.read_text(encoding='utf-8'))


class AutoescaladoTests(unittest.TestCase):
    def despliegues(self):
        nombres = ('gateway', 'subscriptions', 'subscriptions-beat', 'subscriptions-worker', 'rabbitmq')
        return [dict(metadata={'name': n}, spec=dict(replicas=1, template={'spec': {'containers': [
            {'name': n, 'env': [], 'image': 'img'}]}}),
            status=dict(readyReplicas=1, updatedReplicas=1, availableReplicas=1)) for n in nombres]

    def cluster(self, items, hpas):
        c = m.Cluster.__new__(m.Cluster)
        c.recursos, c.estado, c.drenar = {}, Mock(), Mock()
        c.k = Mock(side_effect=[json.dumps({'items': items}), json.dumps({'items': hpas}), '', ''])
        return c

    def test_activo_respalda_pero_no_fija_el_hpa(self):
        c = self.cluster(self.despliegues(), [hpa('gateway'), hpa('subscriptions')])
        c.preparar(fijar_hpa=False)
        c.estado.guardar.assert_called_once()
        self.assertFalse(any(x.args[:2] == ('patch', 'hpa') for x in c.k.call_args_list))
        self.assertEqual(c.hpas_originales['subscriptions']['maximo'], 2)

    def test_fijo_invalida_si_escala_y_activo_lo_registra(self):
        escalado = self.despliegues()[1]
        escalado['spec']['replicas'] = escalado['status']['availableReplicas'] = 2
        for fijo in (True, False):
            c = m.Cluster.__new__(m.Cluster)
            c.hpa_fijo = fijo
            c.recursos = {'subscriptions': self.despliegues()[1]['spec']}
            c.k = Mock(return_value=json.dumps(escalado))
            with self.subTest(fijo=fijo):
                if fijo:
                    with self.assertRaisesRegex(RuntimeError, 'réplicas'):
                        c.verificar()
                else:
                    self.assertEqual(c.verificar(), {'subscriptions': 2})

    def test_activo_igual_exige_misma_imagen_y_un_pod_disponible(self):
        for cambio in ('imagen', 'sin_pods'):
            actual = self.despliegues()[1]
            if cambio == 'imagen':
                actual['spec']['template']['spec']['containers'][0]['image'] = 'otra'
            else:
                actual['status']['availableReplicas'] = 0
            c = m.Cluster.__new__(m.Cluster)
            c.hpa_fijo = False
            c.recursos = {'subscriptions': self.despliegues()[1]['spec']}
            c.k = Mock(return_value=json.dumps(actual))
            with self.subTest(cambio=cambio), self.assertRaises(RuntimeError):
                c.verificar()

    def test_valor_invalido_se_rechaza_antes_de_kubectl(self):
        base = {'URL_COMPARACION': 'https://ejemplo.cl', 'TOKEN_SIN': 'a.b.c', 'TOKEN_CON': 'd.e.f'}
        with patch.dict('os.environ', {**base, 'AUTOESCALADO': 'libre'}, clear=True), \
                patch.object(m, 'comando') as cmd, self.assertRaisesRegex(ValueError, 'AUTOESCALADO'):
            m.configuracion()
        cmd.assert_not_called()

    def test_comparar_pasa_el_modo_al_preparar(self):
        for modo, fijar in (('fijo', True), ('activo', False)):
            cluster = Mock()
            cluster.organizaciones.return_value = ['a', 'b']
            cluster.esperar.return_value = dict(lote_s=1, outbox_ms=[], posterior_ms=[], solapados=0)
            with self.subTest(modo=modo), patch.object(m, 'validar_vigencia'), patch('sys.stdout', io.StringIO()):
                m.comparar(cfg(autoescalado=modo, repeticiones=1), cluster, Mock(return_value=[(201, 1.0)] * 2))
                cluster.preparar.assert_called_once_with(fijar_hpa=fijar)


class TerminalTests(unittest.TestCase):
    def test_tabla_no_corta_la_prueba_en_cp1252(self):
        crudo = io.BytesIO()
        flujo = io.TextIOWrapper(crudo, encoding='cp1252', newline='\n')
        with patch('sys.stdout', flujo):
            m.imprimir('Lote eventos→resumen')
        flujo.flush()
        self.assertEqual(crudo.getvalue(), b'Lote eventos?resumen\n')


if __name__ == '__main__':
    unittest.main()

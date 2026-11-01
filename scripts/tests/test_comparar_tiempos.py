"""Comparador local: no requiere Kubernetes ni RabbitMQ reales."""
import importlib.util
import json
import signal
import sys
from pathlib import Path
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock, patch

RUTA = Path(__file__).resolve().parents[2] / 'k8s/pruebas/comparar_tiempos.py'


def cargar():
    spec = importlib.util.spec_from_file_location('comparar_tiempos', RUTA)
    modulo = importlib.util.module_from_spec(spec)
    with patch.object(sys, 'path', [str(RUTA.parent), *sys.path]):
        spec.loader.exec_module(modulo)
    return modulo


class ComparadorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = cargar()

    def setUp(self):
        control = patch.object(self.m, 'validar_vigencia')
        control.start()
        self.addCleanup(control.stop)

    def test_percentiles_y_diferencia_no_prometen_mejora(self):
        self.assertEqual(self.m.percentil([4, 1, 2, 3], 50), 2.5)
        self.assertAlmostEqual(self.m.percentil([4, 1, 2, 3], 95), 3.85)
        self.assertEqual(self.m.diferencia(10, 15), '+50.0%')
        self.assertEqual(self.m.diferencia(10, 5), '-50.0%')
        self.assertEqual(self.m.diferencia(0, 5), 'N/D')

    def test_rechaza_url_insegura_y_parametros_antes_de_kubectl(self):
        base = {'URL_COMPARACION': 'https://ejemplo.cl', 'TOKEN_SIN': 'a.b.c', 'TOKEN_CON': 'd.e.f'}
        for env in ({'URL_COMPARACION': 'http://ejemplo.cl'},
                    {'URL_COMPARACION': 'https://user:clave@ejemplo.cl'},
                    {'OPERACIONES': '0'}, {'REPETICIONES': 'inf'},
                    {'CONEXIONES': '1000'}, {'SEMILLA': '-1'},
                    {'TOKEN_SIN': 'secreto\nmalformado'}):
            with self.subTest(env=env), patch.dict('os.environ', {**base, **env}, clear=True), patch.object(self.m, 'comando') as cmd:
                with self.assertRaises(ValueError):
                    self.m.configuracion()
                cmd.assert_not_called()

    def test_http_real_no_sigue_redirect_y_cuenta_errores(self):
        recibidas = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                recibidas.append((self.path, self.headers.get('Authorization'),
                                  self.headers.get('X-Correlation-ID')))
                self.rfile.read(int(self.headers['Content-Length']))
                status = 302 if self.path.startswith('/redirect') else 201
                self.send_response(status)
                self.send_header('Location', '/destino')
                self.end_headers()
                self.wfile.write(b'{"id":"11111111-1111-4111-a111-111111111111"}')
            def log_message(self, *_):
                pass
        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as servidor:
            hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
            hilo.start()
            base = f'http://127.0.0.1:{servidor.server_port}'
            resultado = self.m.carga(base + '/api/suscripciones/', 'token', 'correlacion', 3, 2)
            self.assertEqual([r[0] for r in resultado], [201] * 3)
            self.assertTrue(all(r[1] >= 0 for r in resultado))
            self.assertEqual(self.m.carga(base + '/redirect', 'token', 'c', 1, 1)[0][0], 302)
            self.assertEqual(len(recibidas), 4)
            self.assertTrue(all(r[1] == 'Bearer token' for r in recibidas))
            servidor.shutdown()
        hilo.join()

    def test_repite_misma_carga_alterna_orden_y_restaura(self):
        cluster = Mock()
        cluster.organizaciones.return_value = ['org-sin', 'org-con']
        cluster.esperar.return_value = dict(lote_s=3, outbox_ms=[], posterior_ms=[], solapados=0)
        generador = Mock(return_value=[(201, 1.0), (201, 3.0)])
        cfg = dict(url='https://ejemplo.cl/api/suscripciones/', tokens=['sin', 'con'],
                   operaciones=2, repeticiones=3, conexiones=2, semilla=10, espera=10)
        resultado = self.m.comparar(cfg, cluster, generador)
        self.assertEqual([c.args[0] for c in cluster.modo.call_args_list], [0, 1, 1, 0, 0, 1])
        self.assertEqual([c.args[2] for c in cluster.esperar.call_args_list], [12, 12, 14, 14, 16, 16])
        self.assertEqual([c.args[3] for c in cluster.esperar.call_args_list], [29980, 29980, 49960, 49960, 69940, 69940])
        self.assertEqual(cluster.sembrar.call_count, 2)
        cluster.restaurar.assert_called_once()
        self.assertEqual(len(resultado[0]['latencias']), 6)
        self.assertEqual(len(resultado[1]['latencias']), 6)

    def test_fallo_y_ctrl_c_restauran_sin_iniciar_otro_modo(self):
        for error in (RuntimeError('fallo'), KeyboardInterrupt()):
            cluster = Mock()
            cluster.organizaciones.return_value = ['a', 'b']
            cfg = dict(url='https://ejemplo.cl/api/suscripciones/', tokens=['sin', 'con'],
                       operaciones=2, repeticiones=3, conexiones=2, semilla=0, espera=1)
            with self.subTest(error=error), self.assertRaises(type(error)):
                self.m.comparar(cfg, cluster, Mock(side_effect=error))
            cluster.restaurar.assert_called_once()
            self.assertEqual(cluster.modo.call_count, 1)

    def test_401_o_cantidad_incorrecta_no_son_exito(self):
        for respuestas in ([(401, 1)], [(201, 1)]):
            cluster = Mock()
            cluster.organizaciones.return_value = ['a', 'b']
            cfg = dict(url='https://ejemplo.cl/api/suscripciones/', tokens=['sin', 'con'],
                       operaciones=2, repeticiones=1, conexiones=1, semilla=0, espera=1)
            with self.subTest(respuestas=respuestas), self.assertRaises(RuntimeError):
                self.m.comparar(cfg, cluster, Mock(return_value=respuestas))
            cluster.esperar.assert_not_called()
            cluster.restaurar.assert_called_once()

    def test_cola_vacia_no_sustituye_evidencia_por_evento(self):
        cluster = self.m.Cluster.__new__(self.m.Cluster)
        cluster.db = Mock(return_value=dict(eventos=2, hechos=0, incorrectos=0,
                                          pendientes=0, cantidad=2, resumen=[]))
        with self.assertRaisesRegex(RuntimeError, 'acreditar'):
            cluster.esperar('org', 'correlacion', 2, 19980, 2, 1, 0)

    def test_exige_autor_y_resultado_correcto_no_solo_conteos(self):
        for cambios in ({'incorrectos': 1}, {'cantidad': 3}, {'resumen': []}):
            cluster = self.m.Cluster.__new__(self.m.Cluster)
            estado = dict(eventos=2, hechos=2, incorrectos=0, pendientes=0, cantidad=2,
                          resumen=[{'moneda': 'CLP', 'cantidad_activas': 2, 'total_mensual': '19980.00'}])
            cluster.db = Mock(return_value={**estado, **cambios})
            with self.subTest(cambios=cambios), patch.object(self.m.time, 'monotonic', side_effect=[0, 0, 0.1, 2]), patch.object(self.m.time, 'sleep'), self.assertRaises(RuntimeError):
                cluster.esperar('org', 'correlacion', 2, 19980, 2, 1, 1)

    def test_no_acredita_exito_despues_del_plazo_y_acota_consulta(self):
        cluster = self.m.Cluster.__new__(self.m.Cluster)
        cluster.db = Mock(return_value=dict(eventos=2, hechos=2, incorrectos=0, pendientes=0,
            cantidad=2, resumen=[dict(moneda='CLP', cantidad_activas=2, total_mensual='19980.00')]))
        with patch.object(self.m.time, 'monotonic', side_effect=[0, 0, 121]):
            with self.assertRaisesRegex(RuntimeError, 'plazo'):
                cluster.esperar('org', 'corr', 2, 19980, 2, 1, 120)
        self.assertLessEqual(cluster.db.call_args.kwargs['timeout'], 120)

    def test_final_real_no_incluye_espera_posterior_de_publicacion(self):
        cluster = self.m.Cluster.__new__(self.m.Cluster)
        estado = dict(eventos=2, hechos=2, incorrectos=0, pendientes=0, cantidad=2,
                      resumen=[dict(moneda='CLP', cantidad_activas=2, total_mensual='19980.00')])
        estado['filas'] = [dict(evento_id=f'{i:08d}-1111-4111-a111-111111111111', ocurrido_en='2026-11-01T12:00:00Z', publicado_en='2026-11-01T12:00:01Z', hecho_en='2026-11-01T12:00:03Z') for i in (1, 2)]
        cluster.db = Mock(side_effect=[{**estado, 'pendientes': 1}, estado])
        with patch.object(self.m.time, 'monotonic', side_effect=[0, 0, 5, 5, 6]), patch.object(self.m.time, 'sleep'):
            self.assertEqual(cluster.esperar('org', 'corr', 2, 19980, 2, 1, 10)['lote_s'], 3)
        codigo = cluster.db.call_args.args[0]
        compile(codigo, '<consulta de evidencia>', 'exec')
        self.assertIn('correlation_id=', codigo)
        self.assertIn('hecho_por=', codigo)

    def test_fija_hpa_a_replicas_actuales_y_exige_beat(self):
        nombres = ('gateway', 'subscriptions', 'subscriptions-beat', 'subscriptions-worker', 'rabbitmq')
        despliegues = [dict(metadata={'name': n}, spec=dict(replicas=1, template={'spec': {'containers': [
            {'name': n, 'env': []}]}}),
            status=dict(readyReplicas=1, updatedReplicas=1, availableReplicas=1)) for n in nombres]
        hpa = dict(metadata={'name': 'gateway'}, spec=dict(scaleTargetRef={'name': 'gateway'},
                                                        minReplicas=1, maxReplicas=2))
        cluster = self.m.Cluster.__new__(self.m.Cluster)
        cluster.recursos, cluster.estado = {}, Mock()
        cluster.drenar = Mock()
        cluster.k = Mock(side_effect=[json.dumps({'items': despliegues}), json.dumps({'items': [hpa]}), ''])
        cluster.preparar()
        self.assertEqual(cluster.estado.guardar.call_args.args[1], [hpa])
        parche = json.loads(cluster.k.call_args.args[-1])
        self.assertEqual(parche, {'spec': {'minReplicas': 1, 'maxReplicas': 1}})
        cluster.k.side_effect = None
        cluster.restaurar()
        despliegues[2]['status']['availableReplicas'] = 0
        cluster.k = Mock(return_value=json.dumps({'items': despliegues}))
        with self.assertRaisesRegex(RuntimeError, 'Beat'):
            cluster.preparar()
        self.assertEqual(cluster.k.call_count, 1)

    def test_ctrl_c_durante_restauracion_no_abandona_hpa(self):
        cluster = self.m.Cluster.__new__(self.m.Cluster)
        cluster.estado = Mock()
        anterior = signal.getsignal(signal.SIGINT)
        def interrumpir_una_vez():
            signal.raise_signal(signal.SIGINT)
            cluster.estado.completo = True
        cluster.estado.restaurar.side_effect = interrumpir_una_vez
        with self.assertRaises(KeyboardInterrupt):
            cluster.restaurar()
        cluster.estado.restaurar.assert_called_once()
        self.assertTrue(cluster.estado.completo)
        self.assertEqual(signal.getsignal(signal.SIGINT), anterior)



if __name__ == '__main__':
    unittest.main()

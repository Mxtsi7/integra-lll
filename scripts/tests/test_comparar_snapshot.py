"""Snapshot en vivo y autoscaling del comparador: sin cluster ni navegador."""
import importlib.util
import io
import itertools
import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import uuid
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


RESULTADOS = [dict(latencias=[10.0], totales=[1.0], outbox=[5.0], posterior=[1.0], solapados=0)] * 2


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
        self.assertIn('HPA subscriptions: hasta 1 pod(s) · CPU máx. 150m (objetivo 120m) · pediría hasta 2', terminal)

    def test_maximo_del_hpa_solo_cuenta_lecturas_de_su_fase(self):
        registro = self.registro(cfg(autoescalado='activo'), None)
        registro._iniciado = True

        def muestra(t, pods, cpu):
            lectura = dict(minimo=1, maximo=2, objetivo_m=120, cpu_m=cpu, actuales=pods, deseadas=pods, pide=pods)
            registro.datos['muestras'].append(dict(t=t, final=False, hpas={'subscriptions': lectura}))
        # El caso de la revisión: la última lectura del enfriamiento todavía tiene los 2 pods
        # de SIN; esperar_base confirmó 1 en t=11 y los POST de CON van de 11,1 a 15.
        muestra(10, 2, 60)
        registro.datos['fases'].append(dict(tipo='http', ronda=1, modo=1, desde=11.1, hasta=15))
        muestra(12, 1, 30)
        registro.ronda(1, 1, [20.0, 25.0], 12.0, {'subscriptions': 1})
        self.assertEqual(registro.datos['rondas'][0]['hpa']['subscriptions'], dict(pods=1, cpu=30, pide=1))
        self.assertEqual(registro.lineas_hpa(), ['HPA subscriptions: hasta 1 pod(s) · CPU máx. 30m · pidió hasta 1'])
        # Un escalado 1→2 dentro de la fase sí cuenta.
        registro.datos['fases'].append(dict(tipo='http', ronda=1, modo=0, desde=40, hasta=60))
        muestra(41, 1, 50)
        muestra(50, 2, 190)
        registro.ronda(1, 0, [100.0, 120.0], 4.0, {'subscriptions': 2})
        self.assertEqual(registro.datos['rondas'][1]['hpa']['subscriptions'], dict(pods=2, cpu=190, pide=2))
        # Una fase sin lecturas queda sin dato, no con el pico de otra.
        registro.datos['fases'].append(dict(tipo='http', ronda=2, modo=1, desde=70, hasta=71))
        registro.ronda(2, 1, [20.0], 11.0, {'subscriptions': 1})
        self.assertEqual(registro.datos['rondas'][2]['hpa'], {})
        datos = json.loads(registro.json.read_text(encoding='utf-8'))
        self.assertEqual([r['hpa'].get('subscriptions', {}).get('pods') for r in datos['rondas']], [1, 2, None])
        pagina = registro.html.read_text(encoding='utf-8')
        self.assertIn('Autoscaling: pods que alcanzó cada modo', pagina)
        self.assertIn('SIN <b>2</b> pod(s)', pagina)
        self.assertIn('CON <b>1</b> pod(s)', pagina)
        self.assertIn('<td>1 · 30m</td>', pagina)
        self.assertIn('<td>1 · ?</td>', pagina)

    def test_la_fase_medida_toma_su_propia_base_del_hpa(self):
        lecturas = Mock(return_value=json.dumps({'items': [hpa('subscriptions', actuales=1)]}))
        registro = self.registro(cfg(autoescalado='activo'), lecturas)
        registro._iniciado = True
        registro.datos['muestras'].append(dict(t=-1, final=False, hpas={'subscriptions': dict(
            minimo=1, maximo=2, objetivo_m=120, cpu_m=60, actuales=2, deseadas=2, pide=2)}))
        with registro.fase('http', 1, 1):
            abierta = json.loads(registro.json.read_text(encoding='utf-8'))['fases'][-1]
        registro.ronda(1, 1, [20.0], 11.0, None)
        lecturas.assert_called_once()
        self.assertEqual((abierta['tipo'], abierta['hasta']), ('http', None))
        self.assertIsNotNone(registro.datos['fases'][-1]['hasta'])
        self.assertEqual(registro.datos['rondas'][0]['hpa']['subscriptions']['pods'], 1)

    def test_cada_post_se_ve_antes_de_acreditar_la_ronda(self):
        # carga() real contra un servidor local: el primer POST responde y el segundo queda colgado.
        liberar, primero = threading.Event(), threading.Event()
        pedidos = itertools.count(1)

        class Servidor(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                if next(pedidos) == 2:
                    liberar.wait(10)
                cuerpo = json.dumps({'id': str(uuid.uuid4())}).encode()
                self.send_response(201)
                self.send_header('Content-Length', str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)

            def log_message(self, *_):
                pass

        registro = self.registro(cfg(), None)
        avisador = registro.avisador

        def avisador_con_senal(ronda, modo):
            avisar = avisador(ronda, modo)

            def envolver(codigo, ms):
                avisar(codigo, ms)
                primero.set()
            return envolver
        registro.avisador = avisador_con_senal
        vistas = {}

        def mirar(momento):
            registro.guardar(periodica=True)  # Lo mismo que hace el hilo cada 5 s.
            vistas[momento] = (json.loads(registro.json.read_text(encoding='utf-8')),
                               registro.html.read_text(encoding='utf-8'))

        def esperar(*_):
            if 'esperando' not in vistas:
                mirar('esperando')  # Mientras se espera la evidencia del consumidor.
            return dict(lote_s=3.0, outbox_ms=[1.0], posterior_ms=[1.0], solapados=0)
        cluster = Mock()
        cluster.organizaciones.return_value = ['a', 'b']
        cluster.esperar.side_effect = esperar
        fallas = []
        with ThreadingHTTPServer(('127.0.0.1', 0), Servidor) as servidor, patch('sys.stdout', io.StringIO()):
            threading.Thread(target=servidor.serve_forever, daemon=True).start()
            config = cfg(url=f'http://127.0.0.1:{servidor.server_port}/api/suscripciones/',
                         repeticiones=1, conexiones=2)

            def correr():
                try:
                    m.comparar(config, cluster, m.carga, registro)
                except BaseException as error:
                    fallas.append(error)
            hilo = threading.Thread(target=correr)
            hilo.start()
            try:
                self.assertTrue(primero.wait(10))
                mirar('colgado')
            finally:
                liberar.set()
                hilo.join(10)
                servidor.shutdown()
        self.assertEqual(fallas, [])
        datos, pagina = vistas['colgado']
        self.assertEqual(datos['rondas'], [])
        self.assertEqual([(p['ronda'], p['modo'], p['codigo']) for p in datos['provisionales']], [(1, 0, 201)])
        self.assertEqual((datos['fases'][-1]['tipo'], datos['fases'][-1]['hasta']), ('http', None))
        self.assertIn('sin acreditar todavía', pagina)
        self.assertIn('POST SIN RabbitMQ, ronda 1: 1 de 2', pagina)
        datos, _ = vistas['esperando']
        self.assertEqual((len(datos['provisionales']), datos['rondas']), (2, []))
        self.assertIsNotNone(datos['fases'][-1]['hasta'])
        self.assertEqual(len(registro.datos['rondas']), 2)
        self.assertEqual(registro.datos['provisionales'], [])

    def test_lectura_que_llega_tarde_no_cambia_la_evidencia_terminada(self):
        en_vuelo, liberar = threading.Event(), threading.Event()
        llamadas = itertools.count(1)

        def muestrear():
            if next(llamadas) == 2:  # La 1 es la de iniciar(); la 2, la del hilo.
                en_vuelo.set()
                liberar.wait(10)
            return json.dumps({'items': [hpa('subscriptions')]})
        registro = s.Registro(cfg(), muestrear=muestrear, directorio=self.dir, abrir=False,
                              intervalo=0.01, espera_cierre=0)
        with patch('sys.stdout', io.StringIO()):
            registro.iniciar()
        try:
            self.assertTrue(en_vuelo.wait(10))
            registro.detener()  # Antes de restaurar; su plazo de espera vence con la lectura colgada.
            registro.terminar(RESULTADOS)
            html_final = registro.html.read_text(encoding='utf-8')
            json_final = registro.json.read_text(encoding='utf-8')
        finally:
            liberar.set()
            registro._hilo.join(10)
        self.assertFalse(registro._hilo.is_alive())
        self.assertEqual(registro.html.read_text(encoding='utf-8'), html_final)
        self.assertEqual(registro.json.read_text(encoding='utf-8'), json_final)
        self.assertEqual([x['final'] for x in json.loads(json_final)['muestras']], [False, True])
        self.assertEqual(json.loads(json_final)['estado'], 'terminada')

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

    def test_activo_exige_un_hpa_de_1_a_2_por_servicio_antes_de_tocar_nada(self):
        for caso, hpas in (('sin HPA', []), ('falta subscriptions', [hpa('gateway')]),
                           ('duplicado', [hpa('gateway'), hpa('subscriptions'), hpa('subscriptions')]),
                           ('máximo 9', [hpa('gateway'), hpa('subscriptions', maximo=9)])):
            c = self.cluster(self.despliegues(), hpas)
            with self.subTest(caso=caso):
                with self.assertRaisesRegex(RuntimeError, 'HPA'):
                    c.preparar(fijar_hpa=False)
                c.estado.guardar.assert_not_called()
                c.drenar.assert_not_called()
                self.assertEqual(c.k.call_count, 2)  # Solo las dos lecturas: ningún patch.
        # Y comparar() no alcanza a sembrar, cambiar de modo ni mandar POST.
        cluster, generador = Mock(), Mock()
        cluster.organizaciones.return_value = ['a', 'b']
        cluster.preparar.side_effect = RuntimeError('subscriptions tiene 0 HPA')
        with patch.object(m, 'validar_vigencia'), self.assertRaises(RuntimeError):
            m.comparar(cfg(autoescalado='activo'), cluster, generador)
        cluster.sembrar.assert_not_called()
        cluster.modo.assert_not_called()
        generador.assert_not_called()
        cluster.restaurar.assert_called_once()

    def test_si_falta_un_hpa_durante_la_espera_no_se_acredita_el_minimo(self):
        for hpas in ([], [hpa('gateway')]):
            c = m.Cluster.__new__(m.Cluster)
            c.recursos = {'gateway': {}, 'subscriptions': {}}
            c.k = Mock(side_effect=[json.dumps({'items': hpas}), json.dumps({'items': self.despliegues()})])
            with self.subTest(hpas=len(hpas)), patch.object(m.time, 'sleep'), \
                    self.assertRaisesRegex(RuntimeError, 'exactamente uno'):
                c.esperar_base(espera=60)

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
                # Con el HPA libre, cada modo espera el mínimo de pods antes de su carga.
                self.assertEqual(cluster.esperar_base.call_count, 0 if fijar else 2)

    def hpa_y_despliegues(self, pods_subscriptions, deseadas=None):
        hpas = [hpa('gateway'), hpa('subscriptions', actuales=pods_subscriptions,
                                    deseadas=deseadas or pods_subscriptions)]
        despliegues = self.despliegues()
        despliegues[1]['spec']['replicas'] = despliegues[1]['status']['availableReplicas'] = pods_subscriptions
        return [json.dumps({'items': hpas}), json.dumps({'items': despliegues})]

    def test_espera_que_el_hpa_vuelva_al_minimo(self):
        c = m.Cluster.__new__(m.Cluster)
        c.recursos = {'gateway': {}, 'subscriptions': {}}
        # Primero sigue en 2; después el HPA ya quiere 1 pero el Deployment no bajó; al final, 1.
        c.k = Mock(side_effect=self.hpa_y_despliegues(2) + self.hpa_y_despliegues(2, deseadas=1)
                   + self.hpa_y_despliegues(1))
        with patch.object(m.time, 'sleep') as dormir, patch.object(m.time, 'monotonic', return_value=0):
            c.esperar_base(espera=60)
        self.assertEqual(dormir.call_count, 2)
        self.assertEqual(c.k.call_count, 6)

    def test_si_el_hpa_no_baja_la_comparacion_no_sigue(self):
        c = m.Cluster.__new__(m.Cluster)
        c.recursos = {'gateway': {}, 'subscriptions': {}}
        c.k = Mock(side_effect=self.hpa_y_despliegues(2) * 2)
        with patch.object(m.time, 'sleep'), patch.object(m.time, 'monotonic', side_effect=[0, 0, 61]), \
                self.assertRaisesRegex(RuntimeError, 'mínimo'):
            c.esperar_base(espera=60)

    def test_comparar_activo_marca_la_espera_en_el_snapshot(self):
        cluster = Mock()
        cluster.organizaciones.return_value = ['a', 'b']
        cluster.hpas_originales = None
        cluster.esperar.return_value = dict(lote_s=1, outbox_ms=[1.0], posterior_ms=[1.0], solapados=0)
        with tempfile.TemporaryDirectory() as directorio, patch.object(m, 'validar_vigencia'), \
                patch('sys.stdout', io.StringIO()):
            reloj = itertools.count(0, 1.5)
            registro = s.Registro(cfg(autoescalado='activo', repeticiones=1), directorio=directorio, abrir=False,
                                  reloj=lambda: next(reloj))
            m.comparar(cfg(autoescalado='activo', repeticiones=1), cluster,
                       Mock(return_value=[(201, 1.0)] * 2), registro)
            fases = [(f['tipo'], f['modo']) for f in registro.datos['fases']]
        self.assertEqual(fases, [('reinicio', 0), ('enfriamiento', 0), ('http', 0),
                                 ('reinicio', 1), ('enfriamiento', 1), ('http', 1)])


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

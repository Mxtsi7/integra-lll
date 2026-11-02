"""Regresiones solicitadas en la revisión de #141."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch

RUTA = Path(__file__).resolve().parents[2] / 'k8s/pruebas/comparar_tiempos.py'
sys.path.insert(0, str(RUTA.parent))
spec = importlib.util.spec_from_file_location('comparador_revision', RUTA)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def token(exp):
    payload = base64.urlsafe_b64encode(json.dumps({'exp': exp}).encode()).decode().rstrip('=')
    return 'e30.' + payload + '.firma'


class RevisionTests(unittest.TestCase):
    def test_rechaza_estado_heredado_sin_mutar(self):
        for literal, fijo in ((True, False), (False, True)):
            nombres = ('gateway', 'subscriptions', 'subscriptions-beat', 'subscriptions-worker', 'rabbitmq')
            items = [dict(metadata={'name': n}, spec=dict(replicas=1, template={'spec': {'containers': [
                {'name': n, 'env': []}]}}), status=dict(readyReplicas=1, updatedReplicas=1, availableReplicas=1)) for n in nombres]
            if literal:
                items[1]['spec']['template']['spec']['containers'][0]['env'] = [{'name': 'EVENTOS_ASINCRONOS', 'value': '1'}]
            hpa = dict(metadata={'name': 'gateway'}, spec=dict(scaleTargetRef={'name': 'gateway'}, minReplicas=1, maxReplicas=1 if fijo else 2))
            c = m.Cluster.__new__(m.Cluster)
            c.recursos, c.estado, c.drenar = {}, Mock(), Mock()
            c.k = Mock(side_effect=[json.dumps({'items': items}), json.dumps({'items': [hpa]})])
            with self.subTest(literal=literal, fijo=fijo), self.assertRaises(RuntimeError):
                c.preparar()
            c.estado.guardar.assert_not_called()
            self.assertFalse(any(x.args[0] in ('patch', 'set') for x in c.k.call_args_list))

    def test_drenaje_reintenta_y_comprueba_ambas_fuentes(self):
        c = m.Cluster.__new__(m.Cluster)
        c.db = Mock(side_effect=[1, 0])
        c.k = Mock(side_effect=['subscriptions.resumen 1', 'subscriptions.resumen 0'])
        with patch.object(m.time, 'sleep'):
            c.drenar(espera=5)
        self.assertEqual(c.db.call_count, 2)
        self.assertEqual(c.k.call_count, 2)

    def test_token_casi_expirado_se_rechaza_antes_de_mutar(self):
        with self.assertRaisesRegex(ValueError, 'expir'):
            m.validar_vigencia([token(time.time() + 10)])
        m.validar_vigencia([token(time.time() + 600)])

    def test_subproceso_de_restauracion_tiene_grupo_independiente(self):
        with patch.object(m.subprocess, 'run', return_value=Mock(stdout='')) as run:
            m.comando(['kubectl', 'get', 'hpa'], aislar=True)
        opciones = run.call_args.kwargs
        if os.name == 'nt':
            self.assertEqual(opciones['creationflags'], subprocess.CREATE_NEW_PROCESS_GROUP)
        else:
            self.assertTrue(opciones['start_new_session'])

    def test_restaurar_cli_no_requiere_tokens_url_o_generador(self):
        cluster = Mock()
        cluster.estado.cargar.return_value = True
        with patch.object(m, 'Cluster', return_value=cluster), patch.object(m, 'configuracion') as cfg:
            self.assertEqual(m.main(['--restaurar']), 0)
        cfg.assert_not_called()
        cluster.restaurar.assert_called_once()
        cluster.preparar.assert_not_called()

    def test_calentamiento_no_entra_en_muestras_y_crecimiento_es_igual(self):
        cluster = Mock()
        cluster.organizaciones.return_value = ['sin', 'con']
        cluster.esperar.return_value = dict(lote_s=3, evento_ms=[10, 20], outbox_ms=[], posterior_ms=[], solapados=0)
        def generar(_url, _tok, _corr, n, _c):
            return [(201, 100 if n == 1 else 5)] * n
        cfg = dict(url='https://ejemplo.cl/api/suscripciones/', tokens=[token(time.time()+600)]*2,
                   operaciones=2, repeticiones=2, conexiones=1, semilla=10, espera=5, calentamiento=1)
        resultados = m.comparar(cfg, cluster, generar)
        self.assertEqual(resultados[0]['latencias'], [5]*4)
        self.assertEqual(resultados[1]['latencias'], [5]*4)
        self.assertEqual([c.args[2] for c in cluster.esperar.call_args_list], [11, 13, 11, 13, 14, 16, 14, 16])
        self.assertEqual(cluster.drenar.call_count, 4)

    def test_confirmacion_no_interactiva_impide_cambios_sin_si(self):
        with patch.object(m, 'configuracion', return_value={}), patch.object(m.sys.stdin, 'isatty', return_value=False), patch.object(m, 'Cluster') as cluster:
            self.assertEqual(m.main([]), 1)
        cluster.assert_not_called()


if __name__ == '__main__':
    unittest.main()

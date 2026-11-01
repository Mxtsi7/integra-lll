"""Métricas de evidencia persistida, sin Django, reloj local ni clúster."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


RUTA = Path(__file__).resolve().parents[2] / 'k8s/pruebas/metricas_comparador.py'


def fila(numero=1, ocurrido='2026-01-01T00:00:00Z',
         publicado='2026-01-01T00:00:01Z', hecho='2026-01-01T00:00:03Z'):
    return dict(evento_id=f'00000000-0000-4000-8000-{numero:012d}',
                ocurrido_en=ocurrido, publicado_en=publicado, hecho_en=hecho)


class MetricasEventosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('metricas_comparador', RUTA)
        cls.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.m)

    def test_lote_real_de_tres_frente_a_cinco_segundos_sin_incluir_sondeo(self):
        sin = [fila(1, hecho='2026-01-01T00:00:02Z'),
               fila(2, ocurrido='2026-01-01T00:00:01Z')]
        con = [fila(1, hecho='2026-01-01T00:00:04Z'),
               fila(2, ocurrido='2026-01-01T00:00:01Z',
                    publicado='2026-01-01T00:00:02Z',
                    hecho='2026-01-01T00:00:05.100000Z')]
        # Una lectura observada siete segundos después no cambia la evidencia.
        with patch('time.monotonic', return_value=7) as reloj:
            a = self.m.metricas_eventos(sin, 0)
            b = self.m.metricas_eventos(con, 1)
        reloj.assert_not_called()
        self.assertEqual(a['lote_s'], 3.0)
        self.assertEqual(b['lote_s'], 5.1)
        self.assertEqual(a['evento_ms'], [2000.0, 2000.0])
        self.assertEqual(b['evento_ms'], [4000.0, 4100.0])

    def test_espera_de_beat_se_distingue_del_desfase_posterior(self):
        resultado = self.m.metricas_eventos([fila(
            publicado='2026-01-01T00:00:10Z',
            hecho='2026-01-01T00:00:12Z')], 1)
        self.assertEqual(resultado, dict(lote_s=12.0, evento_ms=[12000.0],
            outbox_ms=[10000.0], posterior_ms=[2000.0], solapados=0))

    def test_publicacion_puede_registrarse_despues_de_la_evidencia(self):
        resultado = self.m.metricas_eventos([
            fila(publicado='2026-01-01T00:00:04Z'),
            fila(2, publicado='2026-01-01T00:00:02.500000Z')], 1)
        self.assertEqual(resultado['posterior_ms'], [-1000.0, 500.0])
        self.assertEqual(resultado['outbox_ms'], [4000.0, 2500.0])
        self.assertEqual(resultado['evento_ms'], [3000.0, 3000.0])
        self.assertEqual(resultado['solapados'], 1)
        self.assertEqual(resultado['lote_s'], 3.0)

    def test_modo_sincrono_no_mide_etapas_de_transporte(self):
        datos = fila(publicado=None)
        resultado = self.m.metricas_eventos([datos], 0)
        self.assertEqual(resultado, dict(lote_s=3.0, evento_ms=[3000.0],
            outbox_ms=[], posterior_ms=[], solapados=0))

    def test_offsets_equivalentes_y_fecha_con_espacio_de_default_str(self):
        resultado = self.m.metricas_eventos([fila(
            ocurrido='2025-12-31 21:00:00-03:00',
            publicado='2026-01-01T01:00:01+01:00',
            hecho='2026-01-01 00:00:03+00:00')], 1)
        self.assertEqual(resultado['evento_ms'], [3000.0])
        self.assertEqual(resultado['outbox_ms'], [1000.0])
        self.assertEqual(resultado['posterior_ms'], [2000.0])

    def test_tiempos_iguales_son_validos_y_no_son_solapamiento(self):
        instante = '2026-01-01T00:00:00Z'
        resultado = self.m.metricas_eventos([fila(
            ocurrido=instante, publicado=instante, hecho=instante)], 1)
        self.assertEqual(resultado, dict(lote_s=0.0, evento_ms=[0.0],
            outbox_ms=[0.0], posterior_ms=[0.0], solapados=0))

    def test_rechaza_lote_vacio(self):
        with self.assertRaisesRegex(ValueError, 'vacío'):
            self.m.metricas_eventos([], 1)

    def test_rechaza_eventos_duplicados_incluso_con_distinto_formato_uuid(self):
        a = fila()
        b = {**fila(2), 'evento_id': a['evento_id'].replace('-', '')}
        with self.assertRaisesRegex(ValueError, 'duplicado'):
            self.m.metricas_eventos([a, b], 1)

    def test_rechaza_id_ausente_o_invalido(self):
        for valor in (None, '', 'no-es-uuid', 7):
            with self.subTest(valor=valor), self.assertRaisesRegex(ValueError, 'evento_id'):
                self.m.metricas_eventos([{**fila(), 'evento_id': valor}], 1)

    def test_rechaza_timestamp_faltante_o_invalido(self):
        for campo in ('ocurrido_en', 'publicado_en', 'hecho_en'):
            for valor in (None, '', 'ayer', 7):
                with self.subTest(campo=campo, valor=valor), self.assertRaisesRegex(ValueError, campo):
                    self.m.metricas_eventos([{**fila(), campo: valor}], 1)
            datos = fila()
            del datos[campo]
            with self.subTest(campo=campo), self.assertRaisesRegex(ValueError, campo):
                self.m.metricas_eventos([datos], 1)

    def test_rechaza_fechas_sin_zona_horaria(self):
        for campo in ('ocurrido_en', 'publicado_en', 'hecho_en'):
            with self.subTest(campo=campo), self.assertRaisesRegex(ValueError, 'zona horaria'):
                self.m.metricas_eventos([{**fila(), campo: '2026-01-01T00:00:00'}], 1)

    def test_rechaza_evento_negativo_aunque_el_lote_sea_positivo(self):
        datos = [fila(), fila(2, ocurrido='2026-01-01T00:00:05Z',
                            publicado='2026-01-01T00:00:06Z')]
        with self.assertRaisesRegex(ValueError, 'hecho_en.*ocurrido_en.*reloj'):
            self.m.metricas_eventos(datos, 1)

    def test_rechaza_outbox_negativo(self):
        datos = fila(ocurrido='2026-01-01T00:00:02Z')
        with self.assertRaisesRegex(ValueError, 'publicado_en.*ocurrido_en.*reloj'):
            self.m.metricas_eventos([datos], 1)

    def test_rechaza_modo_desconocido(self):
        for modo in (-1, 2, None, '1'):
            with self.subTest(modo=modo), self.assertRaisesRegex(ValueError, 'modo'):
                self.m.metricas_eventos([fila()], modo)


if __name__ == '__main__':
    unittest.main()

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[2]
VERIFICADOR = RAIZ / "k8s/pruebas/presupuesto.py"
GENERADOR = RAIZ / "k8s/pruebas/carga-fortio.yaml"


def comprobar(generador, namespace):
    return subprocess.run(
        [sys.executable, str(VERIFICADOR), str(RAIZ / "k8s"),
         "--generador", str(generador), "--namespace-generador", namespace],
        capture_output=True, text=True, encoding="utf-8",
    )


class PresupuestoConCarga(unittest.TestCase):
    def test_carga_local_excede_pods_y_memoria(self):
        resultado = comprobar(GENERADOR, "student-forellana")
        self.assertEqual(resultado.returncode, 1, resultado.stdout)
        self.assertIn("2816Mi", resultado.stdout)
        self.assertRegex(resultado.stdout, r"pods\s+13 / 12\s+\*\*\* NO CABE")

    def test_carga_externa_no_consume_cuota_de_aplicacion(self):
        resultado = comprobar(RAIZ / "k8s/pruebas/carga-fortio-otro-namespace.yaml", "student-carga")
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertIn("student-carga", resultado.stdout)
        self.assertIn("2688Mi", resultado.stdout)

    def test_comparador_interno_no_cabe_con_hpa_maximo(self):
        resultado = comprobar(RAIZ / "k8s/pruebas/carga-comparar.yaml", "student-forellana")
        self.assertEqual(resultado.returncode, 1, resultado.stdout)
        self.assertIn("2816Mi", resultado.stdout)
        self.assertRegex(resultado.stdout, r"pods\s+13 / 12\s+\*\*\* NO CABE")

    def test_comparador_externo_conserva_presupuesto_con_hpa_maximo(self):
        resultado = comprobar(RAIZ / "k8s/pruebas/carga-comparar.yaml", "student-carga")
        self.assertEqual(resultado.returncode, 0, resultado.stdout + resultado.stderr)
        self.assertRegex(resultado.stdout, r"pods\s+12 / 12\s+cabe")
        self.assertIn("2688Mi", resultado.stdout)

    def test_carga_local_detecta_cada_limite_de_recursos(self):
        for campo, recurso, valor in (
            ("requests", "cpu", "2000m"), ("limits", "cpu", "2000m"),
            ("requests", "memory", "2Gi"), ("limits", "memory", "4Gi"),
        ):
            with self.subTest(campo=campo, recurso=recurso), tempfile.TemporaryDirectory() as carpeta:
                generador = yaml.safe_load(GENERADOR.read_text(encoding="utf-8"))
                generador["spec"]["template"]["spec"]["containers"][0]["resources"][campo][recurso] = valor
                ruta = Path(carpeta) / "carga.yaml"
                ruta.write_text(yaml.safe_dump(generador), encoding="utf-8")
                resultado = comprobar(ruta, "student-forellana")
                self.assertEqual(resultado.returncode, 1, resultado.stdout)
                self.assertRegex(resultado.stdout, rf"{campo}\.{recurso}[^\n]+\*\*\* NO CABE")

    def test_namespace_declarado_no_se_oculta_con_argumento(self):
        with tempfile.TemporaryDirectory() as carpeta:
            generador = yaml.safe_load(GENERADOR.read_text(encoding="utf-8"))
            generador["metadata"]["namespace"] = "student-forellana"
            ruta = Path(carpeta) / "carga.yaml"
            ruta.write_text(yaml.safe_dump(generador), encoding="utf-8")
            self.assertNotEqual(comprobar(ruta, "student-carga").returncode, 0)

import re
import shutil
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


GENERADOR_EXTERNO = RAIZ / "k8s/pruebas/carga-fortio-otro-namespace.yaml"


def cronjob(memoria):
    return {
        "apiVersion": "batch/v1", "kind": "CronJob",
        "metadata": {"name": "purga-de-prueba"},
        "spec": {"schedule": "15 7 * * *", "jobTemplate": {"spec": {"template": {"spec": {
            "restartPolicy": "OnFailure",
            "containers": [{"name": "purga", "image": "x", "resources": {
                "requests": {"cpu": "25m", "memory": "64Mi"},
                "limits": {"cpu": "100m", "memory": memoria},
            }}],
        }}}}},
    }


def comprobar_copia(modificar):
    """Corre el comprobador sobre una copia de k8s/ que `modificar` altera."""
    with tempfile.TemporaryDirectory() as carpeta:
        copia = Path(carpeta)
        for manifiesto in (RAIZ / "k8s").glob("*.yaml"):
            shutil.copy(manifiesto, copia / manifiesto.name)
        modificar(copia)
        return subprocess.run(
            [sys.executable, str(VERIFICADOR), str(copia),
             "--generador", str(GENERADOR_EXTERNO), "--namespace-generador", "student-carga"],
            capture_output=True, text=True, encoding="utf-8",
        )


def agregar_cronjob(memoria):
    def modificar(copia):
        (copia / "40-cronjob.yaml").write_text(yaml.safe_dump(cronjob(memoria)), encoding="utf-8")
    return modificar


def bajar_hpa_gateway(copia):
    ruta = copia / "30-autoescalado.yaml"
    documentos = list(yaml.safe_load_all(ruta.read_text(encoding="utf-8")))
    for doc in documentos:
        if doc and doc.get("kind") == "HorizontalPodAutoscaler" and doc["metadata"]["name"] == "gateway":
            doc["spec"]["maxReplicas"] = 1
    ruta.write_text(yaml.safe_dump_all(documentos), encoding="utf-8")


class CronJobsEnElPeorCaso(unittest.TestCase):
    """Un CronJob ocupa un pod mientras corre: el horario no le reserva cupo.

    La revisión de #120 rechazó contarlo como "transitorio" y salir con 0.
    """

    def test_la_configuracion_actual_no_tiene_cronjobs_y_entra(self):
        resultado = comprobar_copia(lambda copia: None)
        self.assertEqual(resultado.returncode, 0, resultado.stdout)
        self.assertNotIn("<- CronJob", resultado.stdout)
        self.assertRegex(resultado.stdout, r"pods\s+12 / 12\s+cabe")

    def test_un_cronjob_sin_cupo_de_pods_hace_fallar(self):
        resultado = comprobar_copia(agregar_cronjob("160Mi"))
        self.assertEqual(resultado.returncode, 1, resultado.stdout)
        self.assertIn("<- CronJob", resultado.stdout)
        self.assertRegex(resultado.stdout, r"pods\s+13 / 12\s+\*\*\* NO CABE")

    def test_un_cronjob_con_cupo_entra(self):
        def modificar(copia):
            bajar_hpa_gateway(copia)
            agregar_cronjob("160Mi")(copia)
        resultado = comprobar_copia(modificar)
        self.assertEqual(resultado.returncode, 0, resultado.stdout)
        self.assertIn("<- CronJob", resultado.stdout)
        self.assertRegex(resultado.stdout, r"pods\s+12 / 12\s+cabe")

    def test_un_cronjob_sin_cupo_de_memoria_hace_fallar(self):
        def modificar(copia):
            bajar_hpa_gateway(copia)
            agregar_cronjob("1Gi")(copia)
        resultado = comprobar_copia(modificar)
        self.assertEqual(resultado.returncode, 1, resultado.stdout)
        self.assertRegex(resultado.stdout, r"pods\s+12 / 12\s+cabe")
        self.assertRegex(resultado.stdout, r"limits\.memory[^\n]+\*\*\* NO CABE")


class ManifiestosDesplegados(unittest.TestCase):
    """El presupuesto suma lo que está en k8s/ y supone que eso se despliega.

    Un manifiesto que existe pero `desplegar.sh` no aplica es justo lo que
    encontró la revisión de #120 con el CronJob de la purga.
    """

    def test_desplegar_aplica_todos_los_manifiestos_numerados(self):
        guion = (RAIZ / "k8s/desplegar.sh").read_text(encoding="utf-8")
        bloque = re.search(r"for f in (.*?); do", guion, re.S)
        self.assertIsNotNone(bloque, "no encontré el ciclo que aplica los manifiestos")
        aplicados = {p for p in bloque.group(1).split() if p != "\\"}
        existentes = {f"k8s/{p.name}" for p in (RAIZ / "k8s").glob("[0-9]*.yaml")}
        self.assertEqual(aplicados, existentes)

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


def manifiestos_numerados():
    return {f"k8s/{p.name}" for p in (RAIZ / "k8s").glob("[0-9]*.yaml")}


def manifiestos_que_aplica_el_despliegue():
    """Los manifiestos numerados que `desplegar.sh` aplica, por sus TRES vías.

    Mirar solo el ciclo no alcanza, y asumirlo dio un falso positivo: D-11
    sacó `02-redis-rabbitmq.yaml` del ciclo a propósito —el broker se drena
    antes de reemplazarlo, así que lo aplica `actualizar-rabbitmq.py` después
    de comprobarlo— y la prueba lo leyó como un manifiesto sin desplegar.

    Lo que importa no es por qué vía va, sino que el despliegue lo aplique.
    """
    guion = (RAIZ / "k8s/desplegar.sh").read_text(encoding="utf-8")
    aplicados = set()

    # 1. El ciclo que los recorre con los reemplazos de imagen.
    bloque = re.search(r"for f in (.*?); do", guion, re.S)
    if bloque:
        aplicados |= {p for p in bloque.group(1).split() if p != "\\"}

    # 2. Los `kubectl apply -f` suelos: 00 y 01 van antes de las migraciones.
    aplicados |= set(re.findall(r"kubectl apply -f (k8s/[0-9][^\s]*\.yaml)", guion))

    # 3. Los que aplica un ayudante que el propio guion invoca. Se exige que
    #    el ayudante nombre el manifiesto Y haga `apply`: nombrarlo en un
    #    comentario no es desplegarlo.
    for ayudante in re.findall(r"(?:python3|bash) (k8s/[^\s]+)", guion):
        ruta = RAIZ / ayudante
        if not ruta.is_file():
            continue
        texto = ruta.read_text(encoding="utf-8")
        if "apply" not in texto:
            continue
        aplicados |= {m for m in manifiestos_numerados() if m.split("/")[-1] in texto}

    return aplicados


class ManifiestosDesplegados(unittest.TestCase):
    """El presupuesto suma lo que está en k8s/ y supone que eso se despliega.

    Un manifiesto que existe pero el despliegue no aplica es justo lo que
    encontró la revisión de #120 con el CronJob de la purga.
    """

    def test_el_despliegue_aplica_todos_los_manifiestos_numerados(self):
        self.assertEqual(manifiestos_que_aplica_el_despliegue(), manifiestos_numerados())

    def test_el_ciclo_del_guion_se_sigue_encontrando(self):
        """Si alguien reescribe `desplegar.sh` y el ciclo deja de parsearse,
        la prueba de arriba se volvería un colador en silencio."""
        guion = (RAIZ / "k8s/desplegar.sh").read_text(encoding="utf-8")
        self.assertIsNotNone(
            re.search(r"for f in (.*?); do", guion, re.S),
            "no encontré el ciclo que aplica los manifiestos",
        )

    def test_el_broker_lo_aplica_su_propio_guion_y_no_el_ciclo(self):
        """D-11: `02-redis-rabbitmq.yaml` se aplica después de drenar el
        broker. Si volviera al ciclo se aplicaría dos veces, y la primera sin
        drenar, que es la protección que D-11 agregó."""
        guion = (RAIZ / "k8s/desplegar.sh").read_text(encoding="utf-8")
        bloque = re.search(r"for f in (.*?); do", guion, re.S)
        self.assertNotIn("k8s/02-redis-rabbitmq.yaml", bloque.group(1).split())
        self.assertIn("k8s/02-redis-rabbitmq.yaml", manifiestos_que_aplica_el_despliegue())

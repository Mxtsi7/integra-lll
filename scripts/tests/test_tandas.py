"""Los manifiestos de `k8s/tandas/`: los que NO se aplican en cada despliegue.

Una tanda es una configuración acotada para demostrar un flujo completo de
D-03. Existe porque el namespace no admite todo a la vez y **no se puede pedir
más capacidad**: el núcleo con los dos HPA al máximo ya usa 12/12 pods y
2688/2752 Mi, y las tres APIs de D-03 con sus procesos suman 17 pods.

Estas pruebas comprueban lo que el presupuesto del repo no mira, porque
`k8s/pruebas/presupuesto.py` solo recorre `k8s/*.yaml`.
"""
import glob
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[2]
TANDAS = sorted(glob.glob(str(RAIZ / "k8s/tandas/*.yaml")))

# Cuota y mínimos del namespace, los mismos que usa k8s/pruebas/presupuesto.py.
TOPE_MEMORIA, TOPE_PODS = 2752, 12
MIN_MEMORIA, MIN_CPU = 64, 25


def mi(valor):
    v = str(valor or 0)
    if v.endswith("Mi"):
        return int(v[:-2])
    if v.endswith("Gi"):
        return int(v[:-2]) * 1024
    return 0


def milis(valor):
    v = str(valor or 0)
    return int(v[:-1]) if v.endswith("m") else int(float(v) * 1000) if v != "0" else 0


def documentos(rutas):
    for ruta in rutas:
        for d in yaml.safe_load_all(Path(ruta).read_text(encoding="utf-8")):
            if d:
                yield ruta, d


def plantilla(doc):
    """El pod spec, venga de un Deployment, un StatefulSet o un CronJob."""
    if doc["kind"] == "CronJob":
        return doc["spec"]["jobTemplate"]["spec"]["template"]["spec"]
    return doc["spec"]["template"]["spec"]


def efectivo(spec):
    """El límite de memoria que la cuota le cobra al pod: el mayor entre la
    suma de contenedores y el mayor initContainer."""
    suma = sum(mi((c.get("resources") or {}).get("limits", {}).get("memory"))
               for c in spec.get("containers") or [])
    mayor = max([mi((c.get("resources") or {}).get("limits", {}).get("memory"))
                 for c in spec.get("initContainers") or []], default=0)
    return max(suma, mayor)


def test_hay_manifiestos_de_tanda():
    assert TANDAS, "no encontré k8s/tandas/*.yaml"


def test_respetan_el_minimo_por_contenedor():
    """El LimitRange del namespace rechaza el pod al crearlo si pide menos.
    Ya pasó con redis, web y subscriptions-beat."""
    for ruta, doc in documentos(TANDAS):
        spec = plantilla(doc)
        for clave in ("initContainers", "containers"):
            for c in spec.get(clave) or []:
                pedidos = (c.get("resources") or {}).get("requests") or {}
                assert mi(pedidos.get("memory")) >= MIN_MEMORIA, f"{ruta} {c['name']}"
                assert milis(pedidos.get("cpu")) >= MIN_CPU, f"{ruta} {c['name']}"


def test_los_cronjob_no_se_acumulan_ni_se_cuelgan():
    """Con la cuota al tope, un CronJob mal configurado se come pods: dos
    corridas encimadas, reintentos automáticos o una que no termina nunca."""
    encontrados = 0
    for ruta, doc in documentos(TANDAS):
        if doc["kind"] != "CronJob":
            continue
        encontrados += 1
        spec, trabajo = doc["spec"], doc["spec"]["jobTemplate"]["spec"]
        assert spec.get("concurrencyPolicy") == "Forbid", ruta
        assert spec.get("startingDeadlineSeconds"), ruta
        assert trabajo.get("backoffLimit") == 0, ruta
        assert trabajo.get("activeDeadlineSeconds"), ruta
        assert trabajo["template"]["spec"].get("restartPolicy") == "Never", ruta
    assert encontrados, "no encontré ningún CronJob de tanda"


def test_quedan_fuera_del_ciclo_de_despliegue():
    """`desplegar.sh` aplica los manifiestos numerados de `k8s/`, y una prueba
    exige que los aplique TODOS. Los de tanda no deben aplicarse siempre:
    apuntan a servicios que no están desplegados, así que fallarían en cada
    corrida. Viven en un subdirectorio para quedar fuera de ese glob."""
    numerados = {Path(p).name for p in glob.glob(str(RAIZ / "k8s/[0-9]*.yaml"))}
    for ruta in TANDAS:
        assert Path(ruta).name not in numerados
        assert Path(ruta).parent.name == "tandas"


def test_la_tanda_de_alertas_cabe_sobre_el_nucleo_en_reposo():
    """El generador tiene que caber junto a lo que ya está corriendo. No es
    el presupuesto de la tanda completa --para eso falta el Deployment de
    notifications-- pero sí descarta que el CronJob por sí solo no entre."""
    nucleo_mem = sum(efectivo(plantilla(d)) for _, d in documentos(
        sorted(glob.glob(str(RAIZ / "k8s/*.yaml"))))
        if d["kind"] in ("Deployment", "StatefulSet"))
    nucleo_pods = sum(1 for _, d in documentos(
        sorted(glob.glob(str(RAIZ / "k8s/*.yaml"))))
        if d["kind"] in ("Deployment", "StatefulSet"))

    for ruta, doc in documentos(TANDAS):
        if doc["kind"] != "CronJob":
            continue
        mem = nucleo_mem + efectivo(plantilla(doc))
        pods = nucleo_pods + 1
        assert mem <= TOPE_MEMORIA, f"{ruta}: {mem} Mi sobre {TOPE_MEMORIA}"
        assert pods <= TOPE_PODS, f"{ruta}: {pods} pods sobre {TOPE_PODS}"

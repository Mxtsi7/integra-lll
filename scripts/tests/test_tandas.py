"""Los manifiestos de `k8s/tandas/`: los que NO se aplican en cada despliegue.

Una tanda es una configuración acotada para demostrar un flujo completo de
D-03. Existe porque el namespace no admite todo a la vez y **no se puede pedir
más capacidad**: el núcleo con los dos HPA al máximo ya usa 12/12 pods y
2688/2752 Mi, y las tres APIs de D-03 con sus procesos suman 17 pods.

Estas pruebas comprueban lo que el presupuesto del repo no mira, porque
`k8s/pruebas/presupuesto.py` solo recorre `k8s/*.yaml`.
"""
import glob
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
PERFILES = RAIZ / "k8s/tandas/perfiles.yaml"
# `perfiles.yaml` declara qué se levanta en cada tanda; no es un manifiesto.
TANDAS = [r for r in sorted(glob.glob(str(RAIZ / "k8s/tandas/*.yaml")))
          if Path(r).name != "perfiles.yaml"]

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


# ── Lo que un pod de tanda tiene que traer para poder trabajar ──────────────
# Las dos pruebas siguientes son de una CLASE de error, no de un manifiesto:
# cualquier tanda futura cae en lo mismo si se escribe de memoria.

RED = RAIZ / "k8s/40-red.yaml"


def politicas():
    return [d for _, d in documentos([str(RED)]) if d["kind"] == "NetworkPolicy"]


def origenes_permitidos(destino, puerto):
    """Los valores de `app` que `40-red.yaml` deja llegar a ese destino."""
    permitidos = set()
    for pol in politicas():
        if pol["spec"].get("podSelector", {}).get("matchLabels", {}).get("app") != destino:
            continue
        for regla in pol["spec"].get("ingress") or []:
            if puerto not in [p.get("port") for p in regla.get("ports") or []]:
                continue
            for origen in regla.get("from") or []:
                sel = origen.get("podSelector") or {}
                for exp in sel.get("matchExpressions") or []:
                    if exp.get("key") == "app" and exp.get("operator") == "In":
                        permitidos |= set(exp.get("values") or [])
                app = (sel.get("matchLabels") or {}).get("app")
                if app:
                    permitidos.add(app)
    return permitidos


def test_los_pods_de_tanda_pueden_llegar_a_postgres():
    """Las etiquetas del objeto NO son las del pod: hay que declararlas en
    `spec.template.metadata.labels`. Sin ellas el pod nace pelado y
    `dominio-a-postgres` no lo deja entrar al 5432, porque solo admite los
    `app` de una lista. Pasa recién cuando las políticas se aplican con un
    CNI que las haga cumplir, o sea tarde."""
    permitidos = origenes_permitidos("postgres", 5432)
    assert permitidos, "no pude leer quién puede entrar a postgres en 40-red.yaml"
    for ruta, doc in documentos(TANDAS):
        spec = plantilla(doc)
        if not any("DATABASE_URL" in str(c.get("env")) + str(c.get("envFrom"))
                   for c in spec.get("containers") or []):
            continue
        plantilla_meta = (doc["spec"]["jobTemplate"]["spec"]["template"]
                          if doc["kind"] == "CronJob" else doc["spec"]["template"])
        etiquetas = plantilla_meta.get("metadata", {}).get("labels", {})
        assert etiquetas.get("app") in permitidos, (
            f"{ruta}: el pod tiene app={etiquetas.get('app')!r} y "
            f"40-red.yaml solo deja entrar a {sorted(permitidos)}")
        assert etiquetas.get("app.kubernetes.io/part-of") == "ojoalgasto", ruta


def test_no_usan_la_credencial_administradora_de_postgres():
    """El Secret global `ojoalgasto` trae la URL del usuario `postgres`, que
    es superusuario. `configurar-usuarios-bd.sh` crea una cuenta por esquema
    --NOSUPERUSER, NOBYPASSRLS-- y es la que corresponde. `ESQUEMA_BD` fija
    el search_path pero no limita privilegios."""
    for ruta, doc in documentos(TANDAS):
        for c in plantilla(doc).get("containers") or []:
            for e in c.get("env") or []:
                if e["name"] != "DATABASE_URL":
                    continue
                nombre = (e.get("valueFrom") or {}).get("secretKeyRef", {}).get("name", "")
                assert nombre.startswith("ojoalgasto-bd-"), (
                    f"{ruta} {c['name']}: DATABASE_URL sale de {nombre!r}, "
                    "que es la cuenta administradora")


def test_pueden_bajar_su_imagen_del_registro_privado():
    """Los paquetes del registro son privados. Sin `imagePullSecrets` el pod
    muere en ImagePullBackOff en su primera corrida, y en un CronJob eso se ve
    recién a la hora en punto. Todos los pods del proyecto lo declaran; el
    primer manifiesto de tanda fue el único que no."""
    for ruta, doc in documentos(TANDAS):
        spec = plantilla(doc)
        del_registro = [c for c in spec.get("containers") or []
                        if "ghcr" in str(c.get("image")) or "IMAGEN_" in str(c.get("image"))]
        if not del_registro:
            continue
        secretos = [s.get("name") for s in spec.get("imagePullSecrets") or []]
        assert "ghcr" in secretos, f"{ruta}: falta imagePullSecrets ghcr"


def test_los_cronjob_llegan_suspendidos():
    """Aplicar un manifiesto de tanda no debe arrancar corridas: el servicio
    al que apuntan no está desplegado, y la ventana la decide quien opera.
    Se habilita a mano al entrar a la tanda."""
    for ruta, doc in documentos(TANDAS):
        if doc["kind"] != "CronJob":
            continue
        assert doc["spec"].get("suspend") is True, (
            f"{ruta}: tiene que llegar con suspend: true")


# ── Los perfiles de tanda, contra la herramienta de verdad ─────────────────

def perfiles():
    return yaml.safe_load(PERFILES.read_text(encoding="utf-8"))["tandas"]


def presupuesto(perfil):
    """Corre `presupuesto.py` con los argumentos del perfil."""
    orden = [
        sys.executable, str(RAIZ / "k8s/pruebas/presupuesto.py"), str(RAIZ / "k8s"),
        "--generador", str(RAIZ / "k8s/pruebas/carga-fortio-otro-namespace.yaml"),
        "--namespace-generador", "student-carga",
        "--sin-autoescalado",
    ]
    for carga in perfil.get("pausar") or []:
        orden += ["--pausar", carga]
    for patron in perfil.get("extra") or []:
        orden += ["--extra", str(RAIZ / patron)]
    return subprocess.run(orden, capture_output=True, text=True,
                          encoding="utf-8", timeout=180)


@pytest.mark.parametrize("nombre", sorted(perfiles()))
def test_cada_tanda_declarada_entra_en_la_cuota(nombre):
    """Lo que el perfil levanta hoy tiene que caber. No aprueba la tanda
    --para eso están los `faltan`-- pero descarta que lo ya escrito no entre."""
    r = presupuesto(perfiles()[nombre])
    assert r.returncode == 0, r.stdout + r.stderr
    assert "TODO ENTRA" in r.stdout


@pytest.mark.parametrize("nombre", sorted(perfiles()))
def test_cada_tanda_declara_lo_que_le_falta(nombre):
    """El número verde de arriba NO es una aprobación: los manifiestos que
    faltan no suman porque no existen. Mientras `faltan` tenga algo, la tanda
    no es demostrable, y eso tiene que estar escrito al lado del perfil para
    que nadie lea el "TODO ENTRA" como un permiso."""
    perfil = perfiles()[nombre]
    assert "faltan" in perfil, f"{nombre}: declarar `faltan`, aunque sea vacío"
    assert perfil.get("descripcion"), nombre


def test_los_perfiles_pausan_y_referencian_cosas_que_existen():
    """Un `pausar` mal escrito no pausa nada y el presupuesto sale optimista;
    un `extra` que no encuentra nada, igual. La herramienta ya se niega en los
    dos casos: esto comprueba que los perfiles del repo no los tengan."""
    nombres = {d["metadata"]["name"] for _, d in documentos(
        sorted(glob.glob(str(RAIZ / "k8s/*.yaml"))))
        if d["kind"] in ("Deployment", "StatefulSet")}
    for nombre, perfil in perfiles().items():
        for carga in perfil.get("pausar") or []:
            assert carga in nombres, f"{nombre}: pausa {carga!r}, que no existe"
        for patron in perfil.get("extra") or []:
            assert glob.glob(str(RAIZ / patron)), f"{nombre}: {patron} no encuentra nada"

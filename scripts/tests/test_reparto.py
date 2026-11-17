"""El reparto de servicios entre namespaces (k8s/reparto.env).

Dos guiones leen el mismo archivo: `desplegar-satelite.sh` despliega el
servicio donde dice, y `desplegar.sh` hace que el núcleo lo busque ahí. Si no
coinciden, el gateway responde 502 con todo "desplegado".
"""
from pathlib import Path
import re
import shutil
import subprocess

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
BASH = shutil.which("bash")
SATELITE = "student-de-otro-integrante"


def _texto(ruta):
    return (RAIZ / ruta).read_text(encoding="utf-8")


def _bloque(guion, inicio, fin):
    """Las líneas del guion desde la que empieza con `inicio` hasta `fin`."""
    lineas = guion.splitlines()
    desde = next(i for i, l in enumerate(lineas) if l.startswith(inicio))
    hasta = next(i for i in range(desde, len(lineas)) if lineas[i] == fin)
    return "\n".join(lineas[desde:hasta + 1])


# ── El archivo ──────────────────────────────────────────────────────────────

def test_el_reparto_solo_trae_lineas_que_los_guiones_saben_leer():
    """No se ejecuta como shell: se lee con una expresión regular. Una línea
    con comillas, espacios o un `export` quedaría ignorada EN SILENCIO y el
    servicio se daría por no repartido."""
    declaradas = {}
    for linea in _texto("k8s/reparto.env").splitlines():
        if not linea.strip() or linea.startswith("#"):
            continue
        assert re.fullmatch(r"NS_[A-Z]+=[a-z0-9-]*", linea), linea
        clave, valor = linea.split("=")
        assert clave not in declaradas, f"{clave} está dos veces"
        declaradas[clave] = valor
    assert declaradas.get("NS_NUCLEO"), "el núcleo tiene que estar declarado"
    repartidos = [v for k, v in declaradas.items() if k != "NS_NUCLEO" and v]
    assert declaradas["NS_NUCLEO"] not in repartidos, "un servicio repartido no vive en el núcleo"


def test_los_dos_guiones_leen_el_reparto_con_la_misma_funcion():
    nucleo = _bloque(_texto("k8s/desplegar.sh"), "leer_reparto() {", "}")
    satelite = _bloque(_texto("k8s/desplegar-satelite.sh"), "leer_reparto() {", "}")
    assert nucleo == satelite


# ── Lo que el núcleo renderiza ──────────────────────────────────────────────

def _renderizar(tmp_path, reparto):
    """Ejecuta `leer_reparto` y `renderizar` tal como están en desplegar.sh,
    sobre el ConfigMap real del repo y un reparto.env de prueba."""
    (tmp_path / "k8s").mkdir(exist_ok=True)
    (tmp_path / "k8s/reparto.env").write_text(reparto, encoding="utf-8", newline="\n")
    shutil.copy(RAIZ / "k8s/00-configuracion.yaml", tmp_path / "k8s/00-configuracion.yaml")
    guion = _texto("k8s/desplegar.sh")
    programa = "\n".join([
        "set -euo pipefail",
        'IMAGEN_AUTH=a IMAGEN_SUBSCRIPTIONS=s IMAGEN_GATEWAY=g IMAGEN_WEB=w',
        "HOST_PUBLICO=ojoalgasto-forellana.dev.censei.cl",
        _bloque(guion, "leer_reparto() {", "}"),
        _bloque(guion, 'NS_NOTIFICATIONS="$(leer_reparto NS_NOTIFICATIONS)"', "fi"),
        _bloque(guion, "renderizar() {", "}"),
        "renderizar k8s/00-configuracion.yaml",
    ])
    resultado = subprocess.run([BASH, "-c", programa], cwd=tmp_path, capture_output=True,
                               text=True, encoding="utf-8", timeout=60)
    assert resultado.returncode == 0, resultado.stderr
    return next(d for d in yaml.safe_load_all(resultado.stdout)
                if d["kind"] == "ConfigMap" and d["metadata"]["name"] == "ojoalgasto")["data"]


@pytest.mark.skipif(BASH is None, reason="Requiere bash")
def test_con_notifications_repartido_el_nucleo_lo_busca_en_el_satelite(tmp_path):
    datos = _renderizar(tmp_path, f"NS_NUCLEO=student-nucleo\nNS_NOTIFICATIONS={SATELITE}\n")
    assert datos["URL_NOTIFICATIONS"] == f"http://notifications.{SATELITE}:8005"
    # Guarda datos de organizaciones: si no está en la lista, al eliminar una
    # organización sus alertas quedan huérfanas en el otro namespace.
    assert datos["ELIMINACION_DESTINOS"] == "subscriptions,notifications"
    # Lo que vive en el núcleo se sigue llamando por su nombre corto.
    assert datos["URL_AUTH"] == "http://auth:8001"
    assert datos["URL_SUBSCRIPTIONS"] == "http://subscriptions:8002"


@pytest.mark.skipif(BASH is None, reason="Requiere bash")
@pytest.mark.parametrize("reparto", [
    "NS_NUCLEO=student-nucleo\nNS_NOTIFICATIONS=\n",
    "NS_NUCLEO=student-nucleo\n",
    # Formas que NO son válidas: se ignoran, no se interpretan a medias.
    'NS_NUCLEO=student-nucleo\nNS_NOTIFICATIONS="student-x"\n',
    "NS_NUCLEO=student-nucleo\nNS_NOTIFICATIONS=student-x; rm -rf /\n",
])
def test_sin_reparto_valido_el_nucleo_queda_como_antes(tmp_path, reparto):
    datos = _renderizar(tmp_path, reparto)
    original = next(d for d in yaml.safe_load_all(_texto("k8s/00-configuracion.yaml"))
                    if d["kind"] == "ConfigMap" and d["metadata"]["name"] == "ojoalgasto")["data"]
    assert datos == original


def test_ningun_manifiesto_del_nucleo_se_aplica_en_crudo():
    """`kubectl apply -f k8s/00-configuracion.yaml` a secas devolvería el
    gateway a `http://notifications:8005`, que en el núcleo ya no existe.
    Solo PostgreSQL se aplica directo: no lleva imágenes ni direcciones."""
    crudos = [l.strip() for l in _texto("k8s/desplegar.sh").splitlines()
              if re.search(r"kubectl apply -f k8s/\S+\.yaml", l) and not l.lstrip().startswith("#")]
    assert crudos == ["kubectl apply -f k8s/01-postgres.yaml"]


# ── El guion del satélite ───────────────────────────────────────────────────

def test_el_satelite_apunta_el_nucleo_solo_despues_de_ver_al_consumidor():
    """El orden es la garantía: si el servicio no levanta o el consumidor no
    conecta, el núcleo no se entera y sigue como estaba."""
    guion = _texto("k8s/desplegar-satelite.sh")
    validar = guion.index('kubectl apply -n "$NS_SATELITE" --dry-run=server')
    secretos = guion.index("trasladar_secreto ghcr")
    aplicar = guion.index('kubectl apply -n "$NS_SATELITE" -f "$MANIFIESTOS"')
    consumidor = guion.index('if [ "$escuchando" != "1" ]; then')
    apuntar = guion.index('kubectl patch configmap ojoalgasto -n "$NS_NUCLEO"')
    assert validar < secretos < aplicar < consumidor < apuntar


def test_del_secreto_global_solo_cruza_lo_que_el_servicio_lee():
    """Las claves están nombradas una a una. La administradora de PostgreSQL,
    el secreto de los JWT, las de cifrado y la cuenta de correo no cruzan."""
    guion = _texto("k8s/desplegar-satelite.sh")
    traslados = dict(re.findall(r'^trasladar_secreto (\S+) (\S+)$', guion, flags=re.M))
    assert traslados == {
        "ghcr": ".dockerconfigjson",
        "ojoalgasto": "SECRET_KEY,ELIMINACION_INTERNA_SECRET",
        '"ojoalgasto-bd-$SERVICIO"': "DATABASE_URL",
        "ojoalgasto-rabbitmq": "RABBITMQ_URL",
    }
    # Y coincide con lo que los manifiestos del servicio de verdad referencian.
    referidas = set()
    for ruta in ("k8s/tandas/notifications.yaml", "k8s/tandas/alertas-notifications.yaml"):
        referidas |= set(re.findall(r"secretKeyRef: \{ name: (\S+), key: (\S+) \}", _texto(ruta)))
    cruzan = {(s.strip('"').replace("$SERVICIO", "notifications"), c)
              for s, claves in traslados.items() if s != "ghcr" for c in claves.split(",")}
    assert referidas == cruzan


def test_el_parche_del_nucleo_no_depende_de_la_entrada_estandar():
    """`--patch-file /dev/stdin` no existe para kubectl.exe en Windows: el
    primer despliegue real levantó el servicio y murió justo al apuntar."""
    assert "/dev/stdin" not in "\n".join(
        l for l in _texto("k8s/desplegar-satelite.sh").splitlines() if not l.lstrip().startswith("#"))

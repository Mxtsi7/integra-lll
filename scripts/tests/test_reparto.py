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
        # Namespaces, y una sola excepción: dónde corre la API de connectors
        # mientras la cuota global de Services esté llena (solo `web`).
        assert re.fullmatch(r"NS_[A-Z]+=[a-z0-9-]*", linea) or linea == "CONNECTORS_API=web", linea
        clave, valor = linea.split("=")
        assert clave not in declaradas, f"{clave} está dos veces"
        declaradas[clave] = valor
    assert declaradas.get("NS_NUCLEO"), "el núcleo tiene que estar declarado"
    repartidos = [v for k, v in declaradas.items() if k.startswith("NS_") and k != "NS_NUCLEO" and v]
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
        _bloque(guion, 'NS_CONNECTORS="$(leer_reparto NS_CONNECTORS)"', "fi"),
        _bloque(guion, 'CONNECTORS_API="$(leer_reparto CONNECTORS_API)"', "fi"),
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
    # Pero auth acepta también su nombre calificado: así lo llaman los Jobs de
    # alertas del satélite (S3-FE-21). Sin esto, Django responde 400.
    hosts = datos["ALLOWED_HOSTS"].split(",")
    for forma in ("auth.student-nucleo", "auth.student-nucleo.svc", "auth.student-nucleo.svc.cluster.local"):
        assert forma in hosts
    assert "auth" in hosts and "gateway" in hosts, "no se pierden los que ya estaban"
    assert datos["URL_SUBSCRIPTIONS"] == "http://subscriptions:8002"


@pytest.mark.skipif(BASH is None, reason="Requiere bash")
def test_con_connectors_repartido_el_nucleo_lo_busca_en_su_satelite(tmp_path):
    datos = _renderizar(tmp_path, f"NS_NUCLEO=student-nucleo\nNS_NOTIFICATIONS={SATELITE}\nNS_CONNECTORS=student-otro\n")
    assert datos["URL_CONNECTORS"] == "http://connectors.student-otro:8003"
    assert datos["URL_NOTIFICATIONS"] == f"http://notifications.{SATELITE}:8005"
    # Guarda datos de organizaciones: entra a la lista de borrado.
    assert datos["ELIMINACION_DESTINOS"] == "subscriptions,notifications,connectors"


@pytest.mark.skipif(BASH is None, reason="Requiere bash")
def test_sin_connectors_repartido_se_busca_por_su_nombre_corto(tmp_path):
    datos = _renderizar(tmp_path, f"NS_NUCLEO=student-nucleo\nNS_NOTIFICATIONS={SATELITE}\n")
    assert datos["URL_CONNECTORS"] == "http://connectors:8003"
    assert "connectors" not in datos["ELIMINACION_DESTINOS"].split(",")


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


def _servicios_del_satelite():
    """Lo que `desplegar-satelite.sh` declara por servicio en su `case`."""
    guion = _texto("k8s/desplegar-satelite.sh")
    servicios = {}
    for nombre, cuerpo in re.findall(r"^  (\w+)\)\n(.*?);;", guion, flags=re.M | re.S):
        servicios[nombre] = dict(re.findall(r"(\w+)=([^;\s]+)", cuerpo))
    return servicios


def test_del_secreto_global_solo_cruza_lo_que_el_servicio_lee():
    """Las claves están nombradas una a una y por servicio. La administradora
    de PostgreSQL y el secreto de los JWT no cruzan nunca; las de cifrado,
    solo al servicio que guarda tokens (connectors)."""
    guion = _texto("k8s/desplegar-satelite.sh")
    assert 'trasladar_secreto ojoalgasto "$CLAVES_GLOBALES"' in guion
    servicios = _servicios_del_satelite()
    assert set(servicios) == {"notifications", "connectors"}
    for nombre, datos in servicios.items():
        globales = set(datos["CLAVES_GLOBALES"].split(","))
        assert not {"JWT_SECRET", "POSTGRES_PASSWORD", "DATABASE_URL"} & globales, nombre
        assert ("CLAVES_CIFRADO" in globales) is (nombre == "connectors"), nombre
        cruzan = {("ojoalgasto", c) for c in globales} | {(f"ojoalgasto-bd-{nombre}", "DATABASE_URL")}
        if datos["USA_RABBITMQ"] == "1":
            cruzan.add(("ojoalgasto-rabbitmq", "RABBITMQ_URL"))
        # Lo que los manifiestos del servicio referencian como obligatorio.
        # Los Secrets aparte y opcionales (alertas, OAuth) se trasladan solo
        # si existen y no entran en esta cuenta.
        referidas = set()
        for ruta in (f"k8s/tandas/{nombre}.yaml", f"k8s/tandas/alertas-{nombre}.yaml",
                     f"k8s/tandas/worker-{nombre}.yaml"):
            if (RAIZ / ruta).exists():
                referidas |= set(re.findall(r"secretKeyRef: \{ name: (\S+), key: (\S+) \}", _texto(ruta)))
        assert referidas == cruzan, nombre


def test_el_parche_del_nucleo_no_depende_de_la_entrada_estandar():
    """`--patch-file /dev/stdin` no existe para kubectl.exe en Windows: el
    primer despliegue real levantó el servicio y murió justo al apuntar."""
    assert "/dev/stdin" not in "\n".join(
        l for l in _texto("k8s/desplegar-satelite.sh").splitlines() if not l.lstrip().startswith("#"))


@pytest.mark.skipif(BASH is None, reason="Requiere bash")
def test_con_la_api_de_connectors_en_la_web_el_nucleo_la_busca_ahi(tmp_path):
    datos = _renderizar(
        tmp_path, f"NS_NUCLEO=student-nucleo\nNS_NOTIFICATIONS={SATELITE}\nNS_CONNECTORS=student-otro\nCONNECTORS_API=web\n")
    assert datos["URL_CONNECTORS"] == "http://web:8003"
    assert datos["ELIMINACION_DESTINOS"] == "subscriptions,notifications,connectors"


@pytest.mark.skipif(BASH is None, reason="Requiere bash")
@pytest.mark.parametrize("valor", ["gateway", "subscriptions", "auth"])
def test_connectors_api_solo_admite_web(tmp_path, valor):
    """Otro valor no mete la API en otro pod: se ignora."""
    datos = _renderizar(
        tmp_path, f"NS_NUCLEO=student-nucleo\nNS_CONNECTORS=student-otro\nCONNECTORS_API={valor}\n")
    assert datos["URL_CONNECTORS"] == "http://connectors.student-otro:8003"


def test_la_api_en_la_web_recibe_lo_mismo_que_la_del_satelite_y_no_frena_a_la_web():
    import yaml

    parche = yaml.safe_load(_texto("k8s/parches/connectors-api-en-web.yaml"))
    (contenedor,) = parche["spec"]["template"]["spec"]["containers"]
    # Un pod está listo solo si TODOS sus contenedores lo están: con una
    # readinessProbe acá, la web caería cada vez que connectors arranca.
    assert "readinessProbe" not in contenedor and "startupProbe" not in contenedor
    assert parche["spec"]["template"]["metadata"]["labels"] == {"componente": "con-connectors"}
    referidas = set(re.findall(r"secretKeyRef: \{ name: (\S+), key: (\S+)(?:, optional: true)? \}",
                               _texto("k8s/parches/connectors-api-en-web.yaml")))
    del_satelite = set(re.findall(r"secretKeyRef: \{ name: (\S+), key: (\S+)(?:, optional: true)? \}",
                                  _texto("k8s/tandas/connectors.yaml")))
    assert referidas == del_satelite

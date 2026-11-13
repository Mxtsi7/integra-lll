"""El traslado de configuración y secretos a un namespace satélite.

Las formas de las URL son las reales del cluster: salen de
`k8s/configurar-usuarios-bd.sh`, de `k8s/desplegar.sh` y de
`k8s/00-configuracion.yaml`, que son quienes las escriben.
"""
import base64
import importlib.util
import io
import json
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
NUCLEO = "student-forellana"
SATELITE = "student-maximiliano-saez-cd928ab3cf06"
CLAVE = "0f" * 32  # el formato que generan los guiones: 64 hexadecimales


@pytest.fixture(scope="module")
def satelite():
    spec = importlib.util.spec_from_file_location("satelite", RAIZ / "k8s/satelite.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def b64(texto):
    return base64.b64encode(texto.encode()).decode()


def de_b64(texto):
    return base64.b64decode(texto).decode()


# ── calificar ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("entrada, esperada", [
    (f"postgres://svc_notifications:{CLAVE}@postgres:5432/suscripciones",
     f"postgres://svc_notifications:{CLAVE}@postgres.{NUCLEO}:5432/suscripciones"),
    (f"amqp://ojoalgasto:{CLAVE}@rabbitmq:5672/",
     f"amqp://ojoalgasto:{CLAVE}@rabbitmq.{NUCLEO}:5672/"),
    ("redis://redis:6379/0", f"redis://redis.{NUCLEO}:6379/0"),
    ("http://auth:8001", f"http://auth.{NUCLEO}:8001"),
])
def test_califica_las_url_que_apuntan_al_nucleo(satelite, entrada, esperada):
    assert satelite.calificar(entrada, NUCLEO) == esperada


@pytest.mark.parametrize("valor", [
    "http://notifications:8005",                       # el propio satélite: nombre corto
    "http://connectors:8003",                          # no desplegado en ninguna parte
    "https://ojoalgasto-forellana.dev.censei.cl/oauth/retorno",
    "http://localhost:5173",
    f"http://auth.{NUCLEO}:8001",                      # ya calificada
    "suscripciones", "False", "", "localhost,127.0.0.1,auth,subscriptions,gateway",
    "postgres",                                        # un nombre suelto no es una URL
])
def test_no_toca_lo_que_no_es_una_url_al_nucleo(satelite, valor):
    assert satelite.calificar(valor, NUCLEO) == valor


def test_calificar_dos_veces_da_lo_mismo_que_una(satelite):
    """El guion se puede volver a correr sobre un objeto ya trasladado."""
    una = satelite.calificar(f"amqp://ojoalgasto:{CLAVE}@rabbitmq:5672/", NUCLEO)
    assert satelite.calificar(una, NUCLEO) == una


def test_una_clave_que_contiene_el_nombre_de_un_servicio_no_se_altera(satelite):
    """Lo que se califica es el host, no la primera aparición del texto."""
    url = "amqp://rabbitmq:postgres@rabbitmq:5672/redis"
    assert satelite.calificar(url, NUCLEO) == f"amqp://rabbitmq:postgres@rabbitmq.{NUCLEO}:5672/redis"


# ── Secret ──────────────────────────────────────────────────────────────────

def _secreto_global():
    return {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": "ojoalgasto", "namespace": NUCLEO, "uid": "abc", "resourceVersion": "9",
                         "annotations": {"kubectl.kubernetes.io/last-applied-configuration": "{\"data\":\"...\"}"}},
            "data": {"SECRET_KEY": b64("s" * 64), "JWT_SECRET": b64("j" * 64),
                     "POSTGRES_PASSWORD": b64("admin"), "ELIMINACION_INTERNA_SECRET": b64("e" * 64),
                     "DATABASE_URL": b64("postgres://postgres:admin@postgres:5432/suscripciones")}}


def test_el_secreto_viaja_solo_con_las_claves_nombradas(satelite):
    salida = satelite.secreto_para_satelite(_secreto_global(), NUCLEO, ["SECRET_KEY", "ELIMINACION_INTERNA_SECRET"])
    assert set(salida["data"]) == {"SECRET_KEY", "ELIMINACION_INTERNA_SECRET"}
    # La credencial administradora y el secreto de los JWT se quedan en el núcleo.
    serializado = json.dumps(salida)
    for prohibido in (b64("admin"), b64("j" * 64), "postgres://postgres"):
        assert prohibido not in serializado
    assert de_b64(salida["data"]["SECRET_KEY"]) == "s" * 64


def test_el_secreto_no_arrastra_metadatos_del_nucleo(satelite):
    """La última configuración aplicada de un Secret trae los valores; con ella
    viajaría todo lo que la lista de claves dejó afuera."""
    salida = satelite.secreto_para_satelite(_secreto_global(), NUCLEO, ["SECRET_KEY"])
    assert salida["metadata"] == {"name": "ojoalgasto"}
    assert salida["type"] == "Opaque"


def test_la_url_de_la_base_llega_calificada_y_con_su_clave_intacta(satelite):
    secreto = {"kind": "Secret", "type": "Opaque", "metadata": {"name": "ojoalgasto-bd-notifications"},
               "data": {"DB_PASSWORD": b64(CLAVE),
                        "DATABASE_URL": b64(f"postgres://svc_notifications:{CLAVE}@postgres:5432/suscripciones")}}
    salida = satelite.secreto_para_satelite(secreto, NUCLEO, ["DATABASE_URL"])
    assert de_b64(salida["data"]["DATABASE_URL"]) == (
        f"postgres://svc_notifications:{CLAVE}@postgres.{NUCLEO}:5432/suscripciones")


def test_la_credencial_del_registro_viaja_tal_cual(satelite):
    """`ghcr` es un JSON con el host del registro: no es una URL al núcleo."""
    contenido = json.dumps({"auths": {"ghcr.io": {"username": "u", "password": "p", "auth": "dTpw"}}})
    secreto = {"kind": "Secret", "type": "kubernetes.io/dockerconfigjson", "metadata": {"name": "ghcr"},
               "data": {".dockerconfigjson": b64(contenido)}}
    salida = satelite.secreto_para_satelite(secreto, NUCLEO, [".dockerconfigjson"])
    assert salida["type"] == "kubernetes.io/dockerconfigjson"
    assert de_b64(salida["data"][".dockerconfigjson"]) == contenido


def test_sin_lista_de_claves_no_se_copia_nada(satelite):
    with pytest.raises(satelite.Rechazo, match="nombrar las claves"):
        satelite.secreto_para_satelite(_secreto_global(), NUCLEO, [])


def test_una_clave_ausente_se_nombra_sin_mostrar_valores(satelite):
    with pytest.raises(satelite.Rechazo) as error:
        satelite.secreto_para_satelite(_secreto_global(), NUCLEO, ["SECRET_KEY", "NO_EXISTE"])
    assert "NO_EXISTE" in str(error.value)
    assert "ssss" not in str(error.value) and b64("s" * 64) not in str(error.value)


# ── ConfigMap ───────────────────────────────────────────────────────────────

def _configmap_real():
    """El ConfigMap del repo, que es el que `desplegar.sh` aplica al núcleo."""
    documento = next(d for d in yaml.safe_load_all(
        (RAIZ / "k8s/00-configuracion.yaml").read_text(encoding="utf-8"))
        if d["kind"] == "ConfigMap" and d["metadata"]["name"] == "ojoalgasto")
    documento["metadata"]["namespace"] = NUCLEO
    documento["metadata"]["resourceVersion"] = "123"
    return documento


def test_el_configmap_apunta_al_nucleo_y_admite_el_nombre_calificado(satelite):
    salida = satelite.configmap_para_satelite(_configmap_real(), NUCLEO, SATELITE, "notifications")
    datos = salida["data"]
    assert datos["CELERY_BROKER_URL"] == f"redis://redis.{NUCLEO}:6379/0"
    assert datos["URL_AUTH"] == f"http://auth.{NUCLEO}:8001"
    assert datos["URL_SUBSCRIPTIONS"] == f"http://subscriptions.{NUCLEO}:8002"
    # El propio servicio se sigue llamando por su nombre corto.
    assert datos["URL_NOTIFICATIONS"] == "http://notifications:8005"
    anfitriones = datos["ALLOWED_HOSTS"].split(",")
    # El gateway pide `http://notifications.<satélite>:8005` y Django compara
    # el Host sin el puerto.
    assert f"notifications.{SATELITE}" in anfitriones
    assert "auth" in anfitriones and "localhost" in anfitriones
    assert len(anfitriones) == len(set(anfitriones))
    assert salida["metadata"] == {"name": "ojoalgasto", "labels": {"app.kubernetes.io/part-of": "ojoalgasto"}}


def test_trasladar_el_configmap_dos_veces_no_duplica_anfitriones(satelite):
    una = satelite.configmap_para_satelite(_configmap_real(), NUCLEO, SATELITE, "notifications")
    dos = satelite.configmap_para_satelite(una, NUCLEO, SATELITE, "notifications")
    assert dos["data"] == una["data"]


def test_el_satelite_no_puede_ser_el_nucleo(satelite):
    with pytest.raises(satelite.Rechazo):
        satelite.configmap_para_satelite(_configmap_real(), NUCLEO, NUCLEO, "notifications")


@pytest.mark.parametrize("nombre", ["", "Student-X", "a b", "x;rm -rf", "-inicio", "a" * 64, None])
def test_un_namespace_invalido_se_rechaza(satelite, nombre):
    with pytest.raises(satelite.Rechazo):
        satelite.validar_namespace(nombre)


# ── La orden completa, como la usa el guion ─────────────────────────────────

def test_un_fallo_no_imprime_el_contenido_leido(satelite, monkeypatch, capsys):
    """Si algo falla a mitad de la tubería, lo que llegó por la entrada es un
    Secret. El mensaje no puede traerlo."""
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(_secreto_global())))
    with pytest.raises(SystemExit) as salida:
        satelite.main(["secreto", "--nucleo", NUCLEO, "--claves", "NO_EXISTE"])
    mensaje = str(salida.value.code) + capsys.readouterr().out + capsys.readouterr().err
    assert "NO_EXISTE" in mensaje
    for valor in _secreto_global()["data"].values():
        assert valor not in mensaje


def test_la_orden_escribe_un_objeto_que_kubectl_puede_aplicar(satelite, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(_secreto_global())))
    satelite.main(["secreto", "--nucleo", NUCLEO, "--claves", "SECRET_KEY"])
    objeto = json.loads(capsys.readouterr().out)
    assert objeto["apiVersion"] == "v1" and objeto["kind"] == "Secret"
    assert "namespace" not in objeto["metadata"]

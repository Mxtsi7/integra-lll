"""VI-13: el verificador no puede declarar sano un stack incompleto.

`estado_compose()` compara lo que `docker compose ps` reporta contra el
inventario de servicios de `docker-compose.yml`. Si el inventario se queda
atrás (pasó con `auth-eliminaciones`), un worker caído o inexistente no se
reporta y el script anuncia "sistema completo" sin serlo.

Estas pruebas no tocan Docker: reemplazan `docker compose ps` por una salida
con estado y cubren ausente, detenido y saludable. La primera prueba compara
el inventario con Compose para que una omisión nueva falle aquí.
"""

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
RUTA = RAIZ / "scripts" / "verificar_servicios.py"
COMPOSE = RAIZ / "docker-compose.yml"


def cargar_modulo():
    spec = importlib.util.spec_from_file_location("verificar_servicios", RUTA)
    modulo = importlib.util.module_from_spec(spec)
    # dataclasses resuelve anotaciones por `sys.modules[cls.__module__]`;
    # sin registrar el módulo, @dataclass falla al importar el script.
    sys.modules[spec.name] = modulo
    spec.loader.exec_module(modulo)
    return modulo


@pytest.fixture
def modulo():
    return cargar_modulo()


def fila(nombre, estado="running", salud=None):
    datos = {"Service": nombre, "State": estado}
    if salud is not None:
        datos["Health"] = salud
    return datos


def simular_ps(monkeypatch, modulo, filas):
    """Sustituye `docker compose ps --format json` por las filas dadas."""
    monkeypatch.setattr(modulo.shutil, "which", lambda _: "docker")
    salida = "\n".join(json.dumps(f) for f in filas)
    monkeypatch.setattr(
        modulo.subprocess,
        "run",
        lambda *args, **kwargs: types.SimpleNamespace(
            returncode=0, stdout=salida, stderr=""
        ),
    )


def servicios_de_compose():
    return set(yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"])


def stack_sano():
    return [fila(nombre, salud="healthy") for nombre in servicios_de_compose()]


# ── Coherencia con Compose ───────────────────────────────────────────────


def test_el_inventario_es_exactamente_el_de_compose(modulo):
    """Una fuente desactualizada vuelve a declarar sano un stack incompleto."""
    if not COMPOSE.exists():
        pytest.skip("docker-compose.yml no está")
    assert modulo.CONTENEDORES_ESPERADOS == servicios_de_compose()


def test_las_excepciones_de_healthcheck_coinciden_con_compose(modulo):
    """Sólo los servicios declarados sin healthcheck pueden omitir `healthy`."""
    if not COMPOSE.exists():
        pytest.skip("docker-compose.yml no está")
    servicios = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    sin_healthcheck = {
        nombre
        for nombre, servicio in servicios.items()
        if not servicio.get("healthcheck") or servicio["healthcheck"].get("disable")
    }
    assert modulo.SIN_HEALTHCHECK == sin_healthcheck


# ── auth-eliminaciones: ausente, detenido y saludable ────────────────────


def test_auth_eliminaciones_ausente_se_reporta(modulo, monkeypatch):
    filas = [f for f in stack_sano() if f["Service"] != "auth-eliminaciones"]
    simular_ps(monkeypatch, modulo, filas)

    problemas = modulo.estado_compose()

    assert any(
        "auth-eliminaciones" in p and "no está creado" in p for p in problemas
    ), problemas


def test_auth_eliminaciones_detenido_se_reporta(modulo, monkeypatch):
    filas = stack_sano()
    for f in filas:
        if f["Service"] == "auth-eliminaciones":
            f["State"] = "exited"
    simular_ps(monkeypatch, modulo, filas)

    problemas = modulo.estado_compose()

    assert any(
        "auth-eliminaciones" in p and "exited" in p for p in problemas
    ), problemas


def test_auth_eliminaciones_saludable_no_se_reporta(modulo, monkeypatch):
    simular_ps(monkeypatch, modulo, stack_sano())

    assert modulo.estado_compose() == []


# ── Servicios sin healthcheck: presencia y ejecución ─────────────────────


@pytest.mark.parametrize("nombre", ["frontend", "subscriptions-beat", "redis"])
def test_sin_healthcheck_basta_con_estar_corriendo(modulo, monkeypatch, nombre):
    filas = stack_sano()
    for f in filas:
        if f["Service"] == nombre:
            f.pop("Health", None)
    simular_ps(monkeypatch, modulo, filas)

    assert modulo.estado_compose() == []


@pytest.mark.parametrize("nombre", ["frontend", "subscriptions-beat", "redis"])
def test_sin_healthcheck_detenido_se_reporta(modulo, monkeypatch, nombre):
    filas = stack_sano()
    for f in filas:
        if f["Service"] == nombre:
            f["State"] = "exited"
            f.pop("Health", None)
    simular_ps(monkeypatch, modulo, filas)

    problemas = modulo.estado_compose()

    assert any(nombre in p and "exited" in p for p in problemas), problemas


# ── Servicios con healthcheck: unhealthy sigue siendo un problema ────────


def test_un_healthcheck_no_saludable_se_reporta(modulo, monkeypatch):
    filas = stack_sano()
    for f in filas:
        if f["Service"] == "auth":
            f["Health"] = "starting"
    simular_ps(monkeypatch, modulo, filas)

    problemas = modulo.estado_compose()

    assert any("auth" in p and "starting" in p for p in problemas), problemas


def test_stack_completo_sano_no_reporta_nada(modulo, monkeypatch):
    simular_ps(monkeypatch, modulo, stack_sano())

    assert modulo.estado_compose() == []


# ── Comprobación de /health/ según el modo ────────────────────────────────


def test_esperar_en_contenedores_consulta_dentro_sin_publicar_puertos(modulo, monkeypatch):
    monkeypatch.setattr(
        modulo, "_leer_en_contenedor", lambda nombre, timeout: (True, "200")
    )

    resultados = modulo.esperar_en_contenedores(1, intervalo=0)

    assert all(r.ok for r in resultados)
    assert all("docker compose exec" in r.url for r in resultados)
    assert any("auth" in r.url and ":8001/health/" in r.url for r in resultados)


def test_esperar_en_contenedores_reporta_el_servicio_caido(modulo, monkeypatch):
    def leer(nombre, timeout):
        return (nombre != "auth", "200" if nombre != "auth" else "curl falló")

    monkeypatch.setattr(modulo, "_leer_en_contenedor", leer)

    resultados = modulo.esperar_en_contenedores(0.05, intervalo=0)

    caidos = [r.servicio for r in resultados if not r.ok]
    assert caidos == ["auth"]


def test_sin_compose_espera_los_puertos_publicados(modulo, monkeypatch):
    monkeypatch.setattr(modulo, "_leer", lambda url, timeout: (True, "200"))

    resultados = modulo.esperar("http://localhost", 1, intervalo=0)

    assert all(r.ok for r in resultados)
    assert {r.url for r in resultados} == {
        f"http://localhost:{puerto}/health/" for puerto in modulo.SERVICIOS.values()
    }


def test_gateway_enruta_usa_el_puerto_publicado(modulo, monkeypatch):
    """El gateway vive en 8000; sin el puerto la prueba pegaba al puerto 80."""
    capturadas = []

    def urlopen(peticion, timeout):
        capturadas.append(peticion.full_url)
        raise modulo.error.HTTPError(
            peticion.full_url, 401, "Unauthorized", {}, None
        )

    monkeypatch.setattr(modulo.request, "urlopen", urlopen)

    ok, detalle = modulo._comprobar_gateway_enruta("http://localhost", 1)

    assert ok, detalle
    assert "401" in detalle
    assert capturadas == ["http://localhost:8000/api/usuarios/me/"]


# ── Estado de Compose tras un reinicio ────────────────────────────────────


def test_espera_a_que_compose_salga_de_starting(modulo, monkeypatch):
    """Tras reiniciar, Docker marca "starting" aunque /health/ ya responda."""
    salidas = iter([["auth: health=starting"], []])
    monkeypatch.setattr(modulo, "estado_compose", lambda: next(salidas))
    monkeypatch.setattr(modulo.time, "sleep", lambda _: None)

    assert modulo.esperar_compose_sano(10, intervalo=0) == []


def test_un_problema_distinto_de_starting_no_se_espera(modulo, monkeypatch):
    dormidas = []
    monkeypatch.setattr(modulo, "estado_compose", lambda: ["auth: estado exited"])
    monkeypatch.setattr(modulo.time, "sleep", lambda s: dormidas.append(s))

    assert modulo.esperar_compose_sano(10) == ["auth: estado exited"]
    assert dormidas == []


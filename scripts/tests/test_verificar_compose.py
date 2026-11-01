"""VI-13: el validador estático de Compose no puede quedarse atrás.

`verificar_compose.py` mantiene su propio inventario de servicios HTTP,
workers e infraestructura. Si Compose agrega uno (pasó con
`auth-eliminaciones`), el validador debe exigirlo y conocer sus excepciones.
Estas pruebas comparan ese inventario con `docker-compose.yml` y validan el
Compose real, sin Docker: usan el mismo fallback a PyYAML que el script.
"""

import importlib.util
import sys
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
RUTA = RAIZ / "scripts" / "verificar_compose.py"
COMPOSE = RAIZ / "docker-compose.yml"


def cargar_modulo():
    spec = importlib.util.spec_from_file_location("verificar_compose", RUTA)
    modulo = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = modulo
    spec.loader.exec_module(modulo)
    return modulo


@pytest.fixture
def modulo():
    return cargar_modulo()


def compose() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))


def test_el_inventario_cubre_todos_los_servicios_de_compose(modulo):
    servicios = set(compose()["services"])
    cubiertos = (
        set(modulo.SERVICIOS_HTTP)
        | set(modulo.TRABAJADORES)
        | modulo.INFRAESTRUCTURA
        | {"frontend"}
    )
    assert cubiertos == servicios


def test_el_compose_actual_es_valido(modulo):
    assert modulo.verificar(compose()) == []


def test_si_falta_auth_eliminaciones_se_reporta(modulo):
    datos = compose()
    del datos["services"]["auth-eliminaciones"]

    errores = modulo.verificar(datos)

    assert any("auth-eliminaciones" in error for error in errores), errores


def test_service_healthy_sin_healthcheck_se_reporta(modulo):
    """El merge con D-11 dejó `redis: service_healthy` sin healthcheck."""
    datos = compose()
    datos["services"]["auth"]["depends_on"]["redis"] = {
        "condition": "service_healthy"
    }

    errores = modulo.verificar(datos)

    assert any(
        "auth: espera service_healthy de redis" in error for error in errores
    ), errores


def test_las_excepciones_de_healthcheck_coinciden_con_compose(modulo):
    servicios = compose()["services"]
    sin_healthcheck = {
        nombre
        for nombre, servicio in servicios.items()
        if (servicio.get("healthcheck") or {}).get("disable")
    }
    assert modulo.SIN_HEALTHCHECK_PERMITIDO == sin_healthcheck

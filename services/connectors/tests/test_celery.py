"""
D-01 — `connectors-worker` necesita una app Celery de verdad.

Lo que tiene que quedar demostrado:

- el módulo que nombran docker-compose.yml e infra/k8s después de `-A` tiene
  una app Celery, buscada igual que la busca el CLI al arrancar el worker
- el broker y el backend salen del entorno, no del código
- las tareas de connectors/tasks.py se registran solas y beat solo programa
  tareas que existen
- este worker no comparte cola ni canal de control con el de subscriptions,
  que usa el mismo Redis
"""

import json
import os
import shlex
import subprocess
import sys

import pytest
import yaml  # viene con drf-spectacular
from celery import Celery
from celery.app.utils import find_app
from django.conf import settings

from connectors.tasks import latido
from connectors_config import celery_app

COMPOSE = settings.REPO_ROOT / "docker-compose.yml"
K8S = settings.REPO_ROOT / "infra" / "k8s" / "base" / "servicios.yaml"


def como_lista(valor):
    if valor is None:
        return []
    return shlex.split(valor) if isinstance(valor, str) else list(valor)


def app_del_comando(argumentos):
    """La app que cargaría `celery -A <módulo> ...`, o el error del CLI."""
    assert "-A" in argumentos, f"el comando no dice qué app cargar: {argumentos}"
    return find_app(argumentos[argumentos.index("-A") + 1])


def en_proceso_nuevo(codigo, **variables):
    """Corre `codigo` en otro intérprete y devuelve el JSON que imprime.

    Un proceso nuevo para que nada de lo que ya cargó esta sesión de pytest
    (settings, tareas importadas) esconda lo que se quiere comprobar. Una
    variable en None se quita del entorno."""
    entorno = {**os.environ}
    for nombre, valor in variables.items():
        if valor is None:
            entorno.pop(nombre, None)
        else:
            entorno[nombre] = valor
    resultado = subprocess.run(
        [sys.executable, "-c", codigo],
        cwd=settings.BASE_DIR,
        env=entorno,
        capture_output=True,
        text=True,
    )
    assert resultado.returncode == 0, resultado.stderr
    return json.loads(resultado.stdout.strip().splitlines()[-1])


LEER_CONFIGURACION = """
import json
from django.conf import settings
from connectors_config import celery_app
print(json.dumps({
    "broker_settings": settings.CELERY_BROKER_URL,
    "backend_settings": settings.CELERY_RESULT_BACKEND,
    "broker": celery_app.conf.broker_url,
    "backend": celery_app.conf.result_backend,
}))
"""


# ── El comando de arranque ───────────────────────────────────────────────


def test_compose_arranca_y_sondea_la_app_real():
    if not COMPOSE.exists():
        pytest.skip("docker-compose.yml no está: dentro del contenedor solo se monta el servicio")
    servicios = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    worker = servicios["connectors-worker"]

    arranque = como_lista(worker.get("entrypoint")) + como_lista(worker.get("command"))
    assert app_del_comando(arranque) is celery_app

    sonda = como_lista(worker.get("healthcheck", {}).get("test"))
    if sonda[:1] == ["CMD-SHELL"]:
        sonda = shlex.split(sonda[1])
    assert app_del_comando(sonda) is celery_app


def test_k8s_arranca_la_app_real():
    if not K8S.exists():
        pytest.skip("infra/k8s no está: dentro del contenedor solo se monta el servicio")
    for documento in yaml.safe_load_all(K8S.read_text(encoding="utf-8")):
        if (
            documento
            and documento.get("kind") == "Deployment"
            and documento["metadata"]["name"] == "connectors-worker"
        ):
            contenedor = documento["spec"]["template"]["spec"]["containers"][0]
            argumentos = contenedor.get("command", []) + contenedor.get("args", [])
            assert app_del_comando(argumentos) is celery_app
            return
    pytest.fail("infra/k8s/base/servicios.yaml no tiene el Deployment connectors-worker")


# ── Configuración desde el entorno ───────────────────────────────────────


def test_broker_y_backend_salen_del_entorno():
    leido = en_proceso_nuevo(
        LEER_CONFIGURACION,
        CELERY_BROKER_URL="redis://broker-de-prueba:6379/7",
        CELERY_RESULT_BACKEND="redis://backend-de-prueba:6379/8",
    )
    assert leido == {
        "broker_settings": "redis://broker-de-prueba:6379/7",
        "backend_settings": "redis://backend-de-prueba:6379/8",
        "broker": "redis://broker-de-prueba:6379/7",
        "backend": "redis://backend-de-prueba:6379/8",
    }


def test_sin_backend_propio_los_resultados_van_al_broker():
    leido = en_proceso_nuevo(
        LEER_CONFIGURACION,
        CELERY_BROKER_URL="redis://broker-de-prueba:6379/7",
        CELERY_RESULT_BACKEND=None,
    )
    assert leido["backend_settings"] == "redis://broker-de-prueba:6379/7"
    assert leido["backend"] == "redis://broker-de-prueba:6379/7"


# ── Tareas ───────────────────────────────────────────────────────────────


def test_las_tareas_se_descubren_solas():
    """En un proceso donde nadie importó connectors.tasks, como el worker."""
    leido = en_proceso_nuevo(
        """
import json
from connectors_config import celery_app
celery_app.loader.import_default_modules()
print(json.dumps(sorted(t for t in celery_app.tasks if not t.startswith("celery."))))
"""
    )
    assert "connectors.tasks.latido" in leido


def test_beat_solo_programa_tareas_registradas():
    celery_app.loader.import_default_modules()
    assert celery_app.conf.beat_schedule, "beat corre dentro del worker y no tendría nada que hacer"
    for nombre, entrada in celery_app.conf.beat_schedule.items():
        assert entrada["task"] in celery_app.tasks, nombre


def test_las_tareas_compartidas_usan_esta_app():
    """Si `connectors_config/__init__.py` no cargara la app, un `.delay()`
    desde una vista iría a la app por omisión de Celery y no a este Redis."""
    assert latido.app is celery_app


def test_el_latido_se_ejecuta():
    resultado = latido.apply().get()
    assert resultado["servicio"] == settings.SERVICE_NAME


# ── Convivencia con subscriptions ────────────────────────────────────────


def test_no_comparte_cola_ni_control_con_subscriptions():
    """subscriptions deja la cola y el canal de control por omisión de Celery
    en el mismo Redis. Si este worker leyera esa cola, descartaría las tareas
    del Temporizador por no conocerlas; y su `inspect ping` lo contestaría
    cualquier worker, aunque el de connectors estuviera caído."""
    por_omision = Celery(set_as_current=False).conf
    assert celery_app.conf.task_default_queue == settings.SERVICE_NAME
    assert celery_app.conf.task_default_queue != por_omision.task_default_queue
    assert celery_app.conf.control_exchange == settings.SERVICE_NAME
    assert celery_app.conf.control_exchange != por_omision.control_exchange

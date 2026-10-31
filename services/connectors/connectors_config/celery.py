"""
La aplicación Celery de connectors (D-01).

Un solo proceso, `connectors-worker` (docker-compose.yml e
infra/k8s/base/servicios.yaml), programa y ejecuta las tareas:
`celery -A connectors_config worker --beat`. Antes el comando decía
`-A config`, un paquete vacío que quedó de la plantilla, y el worker no
arrancaba: los settings de este servicio viven en `connectors_config`.

La configuración sale de los settings de Django con prefijo CELERY_ (broker,
backend, cola y calendario). Las tareas van en connectors/tasks.py y se
descubren solas.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "connectors_config.settings")

app = Celery("connectors")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

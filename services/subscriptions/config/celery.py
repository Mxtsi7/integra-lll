"""
La aplicación Celery del servicio: el actor Temporizador del modelo de
casos de uso (CU-24, 26, 27, 28, 29, 31).

Dos procesos en docker-compose.yml:
  - subscriptions-beat   programa las tareas periódicas (CELERY_BEAT_SCHEDULE)
  - subscriptions-worker las ejecuta

Las tareas del dominio van en app/tasks.py y se descubren solas. La única
que vive acá es el latido de prueba.
"""

import logging
import os

from celery import Celery
from django.utils import timezone

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("subscriptions")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

log = logging.getLogger(__name__)


@app.task(name="config.celery.latido")
def latido():
    """Tarea básica de prueba: confirma que beat programa y worker ejecuta."""
    ahora = timezone.localtime()
    log.info("latido del Temporizador a las %s", ahora.strftime("%H:%M:%S"))
    return {"servicio": "subscriptions", "latido": ahora.isoformat()}

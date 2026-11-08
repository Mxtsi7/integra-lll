"""
Tareas Celery de connectors.

Las ejecuta `connectors-worker` y `autodiscover_tasks` las encuentra por vivir
en este módulo. Hoy solo está el latido: la lectura de correo (FE-13) y el
procesamiento de importaciones todavía no existen; cuando lleguen, van aquí y
se programan en CELERY_BEAT_SCHEDULE (connectors_config/settings.py).
"""

import logging

from celery import shared_task
from django.conf import settings
from django.utils import timezone

log = logging.getLogger(__name__)


@shared_task
def latido():
    """Tarea básica de prueba: confirma que beat programa y worker ejecuta."""
    ahora = timezone.localtime()
    log.info("latido de %s a las %s", settings.SERVICE_NAME, ahora.strftime("%H:%M:%S"))
    return {"servicio": settings.SERVICE_NAME, "latido": ahora.isoformat()}

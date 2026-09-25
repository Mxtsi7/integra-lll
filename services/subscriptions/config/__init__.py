# Carga la app de Celery junto con Django, para que las tareas se
# registren aunque el proceso no sea un worker (p. ej. al encolar desde
# una vista).
from .celery import app as celery_app

__all__ = ("celery_app",)

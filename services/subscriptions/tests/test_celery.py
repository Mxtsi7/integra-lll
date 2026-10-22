"""
Pruebas del Temporizador. Corren la tarea en el mismo proceso (apply),
sin broker ni worker: verifican que la app de Celery carga con la
configuración de Django y que la tarea de prueba está registrada y funciona.
"""

from django.conf import settings

from config.celery import app, latido


def test_la_app_de_celery_lee_la_configuracion_de_django():
    assert app.conf.broker_url == settings.CELERY_BROKER_URL
    assert app.conf.timezone == "America/Santiago"


def test_el_latido_esta_programado_en_beat():
    programada = settings.CELERY_BEAT_SCHEDULE["latido-del-temporizador"]
    assert programada["task"] == "config.celery.latido"
    assert programada["task"] in app.tasks


def test_el_latido_se_ejecuta_y_devuelve_la_hora():
    resultado = latido.apply().get()
    assert resultado["servicio"] == "subscriptions"
    assert resultado["latido"].startswith("20")

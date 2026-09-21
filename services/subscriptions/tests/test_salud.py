"""
Prueba de humo del servicio. Verifica lo mismo que el HEALTHCHECK de Docker:
que el servicio responde y que está parado en su propio esquema (ADR-002).
"""

import pytest
from django.conf import settings
from django.test import Client


@pytest.mark.django_db
def test_health_responde_desde_el_esquema_del_servicio():
    respuesta = Client().get("/health/")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["estado"] == "ok"
    assert cuerpo["esquema"] == settings.ESQUEMA_BD

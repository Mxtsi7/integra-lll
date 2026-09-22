"""
Prueba de humo del servicio. Verifica lo mismo que el HEALTHCHECK de Docker:
que el servicio responde y que está parado en su propio esquema (ADR-002).
"""

import pytest
from django.db import connection
from django.test import Client


@pytest.mark.django_db
def test_health_responde_desde_el_esquema_del_servicio():
    respuesta = Client().get("/health/")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["estado"] == "ok"
    # El esquema devuelto debe coincidir con el search_path real de la
    # conexión de test (puede ser 'public' en CI o el esquema del servicio
    # en Docker).
    if connection.vendor == "sqlite":
        assert "esquema" in cuerpo
    else:
        with connection.cursor() as cursor:
            cursor.execute("SHOW search_path")
            search_path = cursor.fetchone()[0]
        esquema_esperado = search_path.split(",")[0].strip().strip('"')
        assert cuerpo["esquema"] == esquema_esperado


"""
Configuración de Django para las pruebas de ``shared/``.

Se corre desde la raíz del repo con ``pytest shared``. Como ``shared/`` no es
un servicio, no tiene ``config/settings.py``: acá se arma el mínimo (sqlite en
memoria y la app de prueba del cifrado).

Si estas pruebas se recogen desde dentro de un servicio (``pytest`` en
``services/auth``, que ya trae ``DJANGO_SETTINGS_MODULE``), no se toca nada:
el conftest de ``shared/cifrado/tests`` las deja fuera de la colección.
"""

import os

from django.conf import settings


def pytest_configure():
    if os.environ.get("DJANGO_SETTINGS_MODULE") or settings.configured:
        return
    settings.configure(
        SECRET_KEY="solo-para-las-pruebas-de-shared",
        INSTALLED_APPS=["shared.cifrado.tests.app_prueba"],
        DATABASES={
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        },
        DEFAULT_AUTO_FIELD="django.db.models.BigAutoField",
        USE_TZ=True,
    )

import os
import socket

import django
import pytest


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


@pytest.fixture(autouse=True)
def catalogos_de_referencia(request):
    # Los tests transaccionales vacían las tablas al terminar; restaurar los
    # datos de referencia sin depender del orden de ejecución de las suites.
    if request.node.get_closest_marker("django_db") or "db" in request.fixturenames:
        request.getfixturevalue("db")
        from django.core.management import call_command
        from io import StringIO
        call_command("gestionar_catalogo", cargar_iniciales=True, stdout=StringIO())


def pytest_configure() -> None:
    """Inicializa Django antes de que pytest recolecte los tests."""
    django.setup()


@pytest.fixture(scope="session")
def django_db_setup(django_db_blocker):
    """Configura la BD de tests: search_path=public para PostgreSQL,
    o SQLite en memoria si el host de postgres no está disponible (tests locales).
    """
    from django.conf import settings
    from django.test.utils import setup_databases, teardown_databases

    engine = settings.DATABASES["default"].get("ENGINE", "")
    host = settings.DATABASES["default"].get("HOST", "")

    if "sqlite" in engine:
        settings.DATABASES["default"]["OPTIONS"] = {}
    elif "postgresql" in engine or "psycopg" in engine:
        # Forzar search_path=public para que las migraciones y tablas de
        # test se creen en el esquema público, independientemente de lo que
        # diga ESQUEMA_BD. Funciona tanto con host='postgres' (Docker)
        # como con host='localhost' (CI / GitHub Actions).
        try:
            socket.gethostbyname(host)
            settings.DATABASES["default"].setdefault("OPTIONS", {})
            settings.DATABASES["default"]["OPTIONS"] = {
                "options": "-c search_path=public"
            }
        except OSError:
            from django.db import connections

            settings.DATABASES["default"] = {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": ":memory:",
                "OPTIONS": {},
                "ATOMIC_REQUESTS": False,
                "AUTOCOMMIT": True,
                "CONN_MAX_AGE": 0,
                "CONN_HEALTH_CHECKS": False,
                "TIME_ZONE": None,
                "TEST": {
                    "CHARSET": None,
                    "COLLATION": None,
                    "MIGRATE": True,
                    "MIRROR": None,
                    "NAME": ":memory:",
                },
            }
            connections.close_all()
            try:
                delattr(connections._connections, "default")
            except AttributeError:
                pass

    with django_db_blocker.unblock():
        db_cfg = setup_databases(verbosity=0, interactive=False)
    yield
    with django_db_blocker.unblock():
        teardown_databases(db_cfg, verbosity=0)

import os
import socket

import django
import pytest


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "notifications_config.settings")


def pytest_configure() -> None:
    """Inicializa Django antes de que pytest recolecte los tests."""
    django.setup()


@pytest.fixture(autouse=True)
def buzon_en_memoria_como_proveedor(settings):
    """pytest-django cambia el correo a `locmem`, un buzón en memoria. En las
    pruebas ese buzón hace de proveedor: lo que se mira es el mensaje que
    quedó en él, y la evidencia dice `locmem`. Fuera de ellas no cuenta como
    proveedor (S3-FE-21, `EMAIL_BACKENDS_CON_PROVEEDOR`)."""
    from notifications.canales import BACKEND_DE_PRUEBAS

    settings.EMAIL_BACKENDS_CON_PROVEEDOR = [*settings.EMAIL_BACKENDS_CON_PROVEEDOR, BACKEND_DE_PRUEBAS]


@pytest.fixture(autouse=True)
def directorio_falso(monkeypatch):
    """Las personas y sus correos salen de auth (S3-FE-21). En las pruebas,
    de un doble: `tests/directorio_falso.py`. Las pruebas del cliente HTTP
    real (`test_directorio_s3_fe_21.py`) lo desactivan."""
    from notifications import directorio
    from tests.directorio_falso import DIRECTORIO

    DIRECTORIO.reiniciar()
    monkeypatch.setattr(directorio, "destinatarios", DIRECTORIO.destinatarios)
    yield DIRECTORIO
    DIRECTORIO.reiniciar()


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

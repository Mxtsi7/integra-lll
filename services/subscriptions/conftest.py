"""Configuración de pruebas del servicio de suscripciones.

Usa PostgreSQL real cuando está disponible (CI / Docker). En local, sin base,
cae a SQLite en memoria solo si la integración no se exige explícitamente.
"""

import os
import socket

import django
import pytest


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def _exigir_integracion() -> bool:
    """En CI, faltar PostgreSQL no puede terminar en una suite SQLite verde."""
    return os.environ.get("EXIGIR_INTEGRACION_USO") == "1"


def _postgres_responde(host: str, puerto: int) -> bool:
    if not host:
        return False
    if host.startswith("/"):
        # Un socket Unix no se comprueba con create_connection desde Windows;
        # se deja que Django intente conectarse.
        return True
    try:
        with socket.create_connection((host, puerto), timeout=2):
            return True
    except OSError:
        return False


def _error_postgres_ausente(host: str, puerto: int) -> RuntimeError:
    return RuntimeError(
        "EXIGIR_INTEGRACION_USO=1 exige PostgreSQL real, pero no responde en "
        f"{host}:{puerto}. Levanta la base con "
        "`docker compose -f docker-compose.analytics-uso-test.yml up -d --wait` "
        "o configura DATABASE_URL; la suite NO puede caer a SQLite."
    )


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

    configuracion = settings.DATABASES["default"]
    engine = configuracion.get("ENGINE", "")
    host = configuracion.get("HOST", "")
    puerto = int(configuracion.get("PORT") or 5432)

    if "sqlite" in engine:
        if _exigir_integracion():
            raise RuntimeError(
                "EXIGIR_INTEGRACION_USO=1 exige PostgreSQL real, pero "
                "DATABASE_URL apunta a SQLite. Configura una base PostgreSQL; "
                "la suite NO puede caer a SQLite."
            )
        settings.DATABASES["default"]["OPTIONS"] = {}
    elif "postgresql" in engine or "psycopg" in engine:
        # Forzar search_path=public para que las migraciones y tablas de
        # test se creen en el esquema público, independientemente de lo que
        # diga ESQUEMA_BD. Funciona tanto con host='postgres' (Docker)
        # como con host='localhost' (CI / GitHub Actions).
        if _postgres_responde(host, puerto):
            settings.DATABASES["default"].setdefault("OPTIONS", {})
            settings.DATABASES["default"]["OPTIONS"] = {
                "options": "-c search_path=public"
            }
        else:
            if _exigir_integracion():
                raise _error_postgres_ausente(host, puerto)
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

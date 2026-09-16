"""Configuración raíz de pytest para el servicio de suscripciones."""

import os

import django
import pytest


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def pytest_configure() -> None:
    """Inicializa Django antes de que pytest recolecte los tests."""
    django.setup()


@pytest.fixture(scope="session")
def django_db_modify_db_settings() -> None:
    """Redirige el search_path a 'public' para la BD de test.

    En producción cada servicio usa su propio schema PostgreSQL
    (ej: ``search_path=subscriptions``), pero la BD de test se crea
    vacía y solo trae el schema ``public``.  Sin este override
    Django no puede crear ``django_migrations`` y los tests fallan con
    ``MigrationSchemaMissing``.
    """
    from django.conf import settings

    settings.DATABASES["default"].setdefault("OPTIONS", {})
    settings.DATABASES["default"]["OPTIONS"] = {
        "options": "-c search_path=public"
    }

from django.db.models.signals import pre_migrate
import pytest


@pytest.fixture(autouse=True)
def sesiones_en_memoria(settings):
    # Doble compartido entre hilos; producción usa Redis, nunca LocMem.
    settings.CACHES = {
        **settings.CACHES,
        "sesiones": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    }
    from django.core.cache import caches
    caches["sesiones"].clear()
    yield
    caches["sesiones"].clear()


@pytest.fixture(autouse=True)
def secreto_eliminacion(monkeypatch):
    # Eliminar una cuenta exige el secreto de la limpieza entre servicios
    # (MX-07). Las pruebas que lo quitan lo hacen a propósito.
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")


def crear_esquema_del_servicio(sender, using, **kwargs):
    from django.conf import settings
    from django.db import connections

    with connections[using].cursor() as cursor:
        cursor.execute(
            f'CREATE SCHEMA IF NOT EXISTS "{settings.ESQUEMA_BD}"'
        )


pre_migrate.connect(
    crear_esquema_del_servicio,
    dispatch_uid="crear-esquema-del-servicio",
)


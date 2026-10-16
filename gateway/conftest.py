import pytest
from django.core.cache import caches


@pytest.fixture(autouse=True)
def sesiones_en_memoria(settings):
    settings.CACHES = {
        **settings.CACHES,
        "sesiones": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    }
    caches["sesiones"].clear()
    yield
    caches["sesiones"].clear()

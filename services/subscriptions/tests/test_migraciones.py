import pytest
from django.core.management import call_command


@pytest.mark.django_db
def test_los_modelos_no_tienen_cambios_sin_migracion():
    """Evita que un cambio en models.py llegue a main sin su migracion y que
    la siguiente persona la arrastre, sin querer, dentro de la suya."""
    try:
        call_command("makemigrations", "app", "--check", "--dry-run", verbosity=0)
    except SystemExit:
        pytest.fail(
            "models.py tiene cambios sin migracion: "
            "corre `python manage.py makemigrations app` y sube el archivo"
        )

import os

import pytest

if os.environ.get("DJANGO_SETTINGS_MODULE"):
    # Un servicio está corriendo su propio pytest y llegó hasta acá porque
    # shared/ va copiado dentro de la imagen. Estas pruebas necesitan su
    # propia configuración (shared/conftest.py) y `cryptography`, que no
    # todos los servicios instalan. Se dejan fuera.
    collect_ignore_glob = ["*"]
else:
    from shared.cifrado.cifrador import VARIABLE_DE_ENTORNO, generar_clave, reiniciar_cifrador

    @pytest.fixture
    def claves(monkeypatch):
        """Deja CLAVES_CIFRADO con una clave recién generada.

        Devuelve una función para cambiar la lista a mitad de la prueba
        (simula una rotación) y reinicia el cifrador cacheado cada vez."""

        def fijar(*lista):
            monkeypatch.setenv(VARIABLE_DE_ENTORNO, ",".join(lista))
            reiniciar_cifrador()

        fijar(generar_clave())
        yield fijar
        reiniciar_cifrador()

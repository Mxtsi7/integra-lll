"""
El hasher de contraseñas: el PBKDF2 de Django con las iteraciones en settings.

Existe por el cluster del ramo. Sus nodos son CPU virtuales viejas (Sandy
Bridge, sin extensiones SHA) y cada contenedor tiene un tope de CPU: con las
870.000 iteraciones que trae Django, un hash toma unos 15 s en el pod de auth,
el gateway corta a los 10 s y el login y el registro responden 504.

Mismo algoritmo (`pbkdf2_sha256`), así que los hashes que ya existen se siguen
verificando. Si las iteraciones guardadas no coinciden con las configuradas,
Django re-hashea la contraseña sola en el siguiente login correcto.
"""

from django.conf import settings
from django.contrib.auth.hashers import PBKDF2PasswordHasher


class PBKDF2Configurable(PBKDF2PasswordHasher):
    # Propiedad y no atributo de clase: se lee en cada uso, así las pruebas
    # pueden cambiarla con override_settings.
    @property
    def iterations(self):
        return settings.PBKDF2_ITERACIONES

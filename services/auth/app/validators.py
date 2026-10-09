"""Política central de contraseñas (RF-01.1 / MX-30).

Único lugar de verdad. Reglas:
    - Mínimo 8 caracteres.
    - Al menos 1 letra ASCII (a-z / A-Z).
    - Al menos 1 número ASCII (0-9).

Uso en serializers DRF::

    from app.validators import validador_contrasena

    password = serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        style={"input_type": "password"},
        validators=[validador_contrasena],
    )

Uso en formularios Django::

    from django import forms
    from app.validators import validador_contrasena

    password = forms.CharField(
        strip=False,
        widget=forms.PasswordInput,
        validators=[validador_contrasena],
    )

El ``strip=False`` es obligatorio: el recorte por defecto de los
formularios eliminaría los espacios antes de validar y contradiría el
comportamiento de los serializers DRF (``trim_whitespace=False``), donde
los espacios cuentan como caracteres y se preservan tal cual.

Notas de seguridad (leer antes de reutilizar):
    - El validador solo revisa la contraseña original en texto plano,
      tal como la escribe el usuario. No transforma ni hashea nada.
    - El almacenamiento siempre debe pasar por ``user.set_password()``
      o ``User.objects.create_user()``; nunca se guarda el valor validado.
    - No aplicar este validador al hash ya almacenado (``user.password``):
      un hash PBKDF2 no tiene por qué cumplir la política de composición
      y validarlo no aporta nada.

El mensaje de error es único y está en español para que web y móvil
muestren siempre el mismo texto (ver ``MENSAJE_POLITICA_CONTRASENA``).
"""

from __future__ import annotations

import re

from django.core.exceptions import ValidationError
from django.utils.deconstruct import deconstructible

LONGITUD_MINIMA_CONTRASENA = 8

MENSAJE_POLITICA_CONTRASENA = (
    "La contraseña debe tener al menos 8 caracteres, una letra y un número."
)

_LETRA_RE = re.compile(r"[A-Za-z]")
_NUMERO_RE = re.compile(r"[0-9]")


@deconstructible
class ValidadorPoliticaContrasena:
    """Validador único de la política RF-01.1.

    Compatible con dos superficies:
    - Validador de campo Django/DRF (``__call__``).
    - Validador de ``AUTH_PASSWORD_VALIDATORS`` (``validate`` /
      ``get_help_text``).

    Siempre levanta el mismo mensaje (:data:`MENSAJE_POLITICA_CONTRASENA`)
    para que los clientes reciban errores consistentes.
    """

    message = MENSAJE_POLITICA_CONTRASENA
    code = "politica_contrasena"

    def __call__(self, value: object) -> None:
        if not isinstance(value, str):
            raise ValidationError(self.message, code=self.code)

        if (
            len(value) < LONGITUD_MINIMA_CONTRASENA
            or _LETRA_RE.search(value) is None
            or _NUMERO_RE.search(value) is None
        ):
            raise ValidationError(self.message, code=self.code)

    # Interfaz AUTH_PASSWORD_VALIDATORS (createsuperuser, validate_password).
    def validate(self, password: str, user=None) -> None:
        self.__call__(password)

    def get_help_text(self) -> str:
        return self.message

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ValidadorPoliticaContrasena)


#: Instancia compartida: importar esta en lugar de crear nuevas.
validador_contrasena = ValidadorPoliticaContrasena()

"""
``CampoCifrado``: un ``TextField`` que cifra al guardar y descifra al leer.

Lo que ve el código es texto plano; lo que ve la base es un token Fernet.
Tres reglas que importan:

1. **Una fila ilegible no rompe a las demás.** Si una fila se cifró con una
   clave que ya no está en ``CLAVES_CIFRADO``, leerla no lanza excepción:
   entrega ``SECRETO_ILEGIBLE`` (falsy). Así un listado de cuentas sigue
   funcionando y esa cuenta se puede marcar como "requiere reautorizar".
   Intentar **guardar** un ``SECRETO_ILEGIBLE`` sí falla, para no pisar el
   dato original con basura.
2. **No se puede filtrar por un campo cifrado.** Cada cifrado usa un IV
   distinto, así que ``filter(access_token="x")`` nunca coincide. Es a
   propósito: la base no debe poder responder "¿quién tiene este token?".
3. **El valor leído recuerda con qué clave se cifró** (``TextoDescifrado``),
   para que ``rotar_claves`` sepa qué filas re-cifrar sin tocar las demás.
"""

from __future__ import annotations

import logging

from django.db import models

from .cifrador import ClaveDeCifradoInvalida, obtener_cifrador

log = logging.getLogger(__name__)


class SecretoIlegible:
    """Lo que entrega ``CampoCifrado`` cuando la fila no se pudo descifrar.

    Es falsy y su texto nunca contiene el valor cifrado."""

    __slots__ = ()

    def __bool__(self) -> bool:
        return False

    def __str__(self) -> str:
        return "<secreto ilegible>"

    __repr__ = __str__

    def __eq__(self, otro) -> bool:
        return isinstance(otro, SecretoIlegible)

    def __hash__(self) -> int:
        return hash("SecretoIlegible")


SECRETO_ILEGIBLE = SecretoIlegible()


class TextoDescifrado(str):
    """Un ``str`` normal con una marca: si el cifrado de origen usó la clave
    vigente. Sirve solo para la rotación; en todo lo demás es un ``str``."""

    cifrado_con_clave_actual: bool = True

    def __new__(cls, valor: str, cifrado_con_clave_actual: bool = True):
        objeto = super().__new__(cls, valor)
        objeto.cifrado_con_clave_actual = cifrado_con_clave_actual
        return objeto


class CampoCifrado(models.TextField):
    """Texto cifrado en reposo con Fernet. Ver el docstring del módulo."""

    description = "Texto cifrado en reposo (Fernet, CLAVES_CIFRADO)"

    def get_prep_value(self, value):
        if value is None:
            return None
        if isinstance(value, SecretoIlegible):
            raise ClaveDeCifradoInvalida(
                f"No se puede guardar '{self.name}': su valor actual es ilegible con "
                "las claves configuradas. Hay que volver a obtener el secreto "
                "(reautorizar), no sobrescribirlo."
            )
        value = super().get_prep_value(value)
        return obtener_cifrador().cifrar(str(value))

    def from_db_value(self, value, expression, connection):
        if value is None:
            return None
        cifrador = obtener_cifrador()
        try:
            texto = cifrador.descifrar(value)
        except ClaveDeCifradoInvalida:
            # Sin el valor: el log no debe contener ni el cifrado ni la clave.
            log.warning(
                "CampoCifrado '%s': valor ilegible con las claves actuales; "
                "se entrega SECRETO_ILEGIBLE",
                self.name,
            )
            return SECRETO_ILEGIBLE
        return TextoDescifrado(texto, cifrador.cifrado_con_clave_actual(value))

    def to_python(self, value):
        if value is None or isinstance(value, SecretoIlegible):
            return value
        return super().to_python(value)

    def value_to_string(self, obj):
        # Serialización de Django (dumpdata, etc.): nunca el texto plano.
        valor = self.value_from_object(obj)
        return "" if valor is None else "***"

"""
El cifrador: Fernet (AES-128-CBC + HMAC-SHA256, de la librería ``cryptography``).

Decisiones:

- **Cifrado simétrico autenticado.** Fernet firma lo que cifra: si alguien
  altera un byte en la base, descifrar falla en vez de devolver basura.
- **Varias claves a la vez** (``MultiFernet``). ``CLAVES_CIFRADO`` es una
  lista separada por comas. La **primera** cifra; **todas** descifran. Así se
  rota una clave sin dejar ilegible lo que ya estaba guardado:
  se agrega la nueva adelante, se re-cifra todo (``rotar_claves``), y recién
  entonces se quita la vieja.
- **Los errores no llevan el secreto ni la clave.** Ningún mensaje de
  excepción de este módulo incluye el texto cifrado, el descifrado ni las
  claves. Lo que llegue a un log o a una respuesta HTTP es solo el motivo.
- **Sin dependencia de Django.** Este archivo se puede usar desde un script,
  una tarea Celery o una prueba sin levantar nada.
"""

from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

VARIABLE_DE_ENTORNO = "CLAVES_CIFRADO"
SEPARADOR = ","


class ErrorDeCifrado(Exception):
    """Base de los errores de este módulo. Sus mensajes nunca incluyen el secreto."""


class CifradoNoConfigurado(ErrorDeCifrado):
    """Falta ``CLAVES_CIFRADO`` o alguna de sus claves no es una clave Fernet."""


class ClaveDeCifradoInvalida(ErrorDeCifrado):
    """El valor no se pudo descifrar con ninguna de las claves configuradas."""


def generar_clave() -> str:
    """Una clave Fernet nueva: 44 caracteres base64 url-safe. Se guarda en el
    gestor de secretos del entorno, nunca en el repositorio."""
    return Fernet.generate_key().decode("ascii")


def redactar(valor) -> str:
    """Lo que va a un log en lugar de un secreto. Nunca devuelve el valor."""
    if valor is None or valor == "":
        return "(vacío)"
    return "***"


def _fernet_desde(clave: str, posicion: int) -> Fernet:
    try:
        return Fernet(clave.strip().encode("ascii"))
    except (ValueError, TypeError, UnicodeEncodeError):
        raise CifradoNoConfigurado(
            f"La clave #{posicion} de {VARIABLE_DE_ENTORNO} no es una clave Fernet "
            "válida (44 caracteres base64 url-safe). Genera una con generar_clave()."
        ) from None


class Cifrador:
    """Cifra con la primera clave y descifra con cualquiera de la lista."""

    def __init__(self, claves):
        claves = [c for c in (claves or []) if c and c.strip()]
        if not claves:
            raise CifradoNoConfigurado(
                f"{VARIABLE_DE_ENTORNO} está vacía: hace falta al menos una clave Fernet."
            )
        self._fernets = [_fernet_desde(c, i + 1) for i, c in enumerate(claves)]
        self._actual = self._fernets[0]
        self._todas = MultiFernet(self._fernets)

    @classmethod
    def desde_entorno(cls, variable: str = VARIABLE_DE_ENTORNO) -> "Cifrador":
        valor = os.environ.get(variable, "")
        if not valor.strip():
            raise CifradoNoConfigurado(
                f"Falta la variable de entorno {variable} (una o más claves Fernet "
                "separadas por coma, la primera es la vigente)."
            )
        return cls(valor.split(SEPARADOR))

    @property
    def cantidad_de_claves(self) -> int:
        return len(self._fernets)

    def cifrar(self, texto: str) -> str:
        """Texto plano → texto cifrado (ASCII, apto para una columna de texto)."""
        if not isinstance(texto, str):
            raise TypeError("Solo se cifra texto (str)")
        return self._actual.encrypt(texto.encode("utf-8")).decode("ascii")

    def descifrar(self, cifrado: str) -> str:
        """Texto cifrado → texto plano, probando todas las claves en orden."""
        try:
            return self._todas.decrypt(cifrado.encode("ascii")).decode("utf-8")
        except (InvalidToken, TypeError, ValueError, UnicodeError, AttributeError):
            raise ClaveDeCifradoInvalida(
                "No se pudo descifrar el valor: fue cifrado con una clave que ya no "
                f"está en {VARIABLE_DE_ENTORNO}, o el dato guardado está dañado."
            ) from None

    def cifrado_con_clave_actual(self, cifrado: str) -> bool:
        """True si ``cifrado`` se hizo con la primera clave (no necesita rotación)."""
        try:
            self._actual.decrypt(cifrado.encode("ascii"))
            return True
        except (InvalidToken, TypeError, ValueError, AttributeError):
            return False

    def rotar(self, cifrado: str) -> str:
        """Re-cifra con la clave vigente un valor cifrado con una clave anterior."""
        return self.cifrar(self.descifrar(cifrado))


# ── Instancia compartida ──────────────────────────────────────────────
# Leer el entorno y construir los Fernet cuesta; se hace una vez por proceso.
# Los servicios cargan .env a os.environ con django-environ, así que el
# campo de modelo y cualquier script ven la misma variable.

_cifrador: Cifrador | None = None


def obtener_cifrador() -> Cifrador:
    global _cifrador
    if _cifrador is None:
        _cifrador = Cifrador.desde_entorno()
    return _cifrador


def reiniciar_cifrador() -> None:
    """Olvida la instancia cacheada. Para pruebas y para después de rotar claves
    en un proceso que sigue vivo."""
    global _cifrador
    _cifrador = None

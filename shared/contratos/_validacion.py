"""Cómo se valida un sobre contra su esquema JSON. Igual para todos los contratos.

Está aparte para que `candidato_confirmado` y `candidato_aplicado` no tengan
cada uno su copia: dos copias de la misma validación terminan validando
distinto, y la que se queda atrás suele ser la que no tiene `FormatChecker`
(sin él, `format: uuid` y `format: date` no se comprueban).
"""

from __future__ import annotations

import functools
import json
from importlib.resources import files


@functools.lru_cache(maxsize=None)
def esquema(nombre_archivo: str) -> dict:
    return json.loads(files("shared.contratos").joinpath(nombre_archivo).read_text("utf-8"))


@functools.lru_cache(maxsize=None)
def _validador(nombre_archivo: str):
    # Import perezoso: `jsonschema` está en los servicios que usan esto, pero
    # importarlo al cargar el módulo haría que un problema de despliegue
    # apareciera como un ImportError lejos de donde corresponde.
    from jsonschema import Draft202012Validator, FormatChecker

    return Draft202012Validator(esquema(nombre_archivo), format_checker=FormatChecker())


def errores(nombre_archivo: str, sobre) -> list[str]:
    """Los incumplimientos del contrato, todos y en texto. Vacío si cumple."""
    if not isinstance(sobre, dict):
        return [f"el sobre no es un objeto JSON, es {type(sobre).__name__}"]
    fallos = sorted(_validador(nombre_archivo).iter_errors(sobre), key=lambda e: [str(p) for p in e.path])
    return [f"{'.'.join(str(p) for p in e.path) or '(raíz)'}: {e.message}" for e in fallos]

"""Valida el acuse `candidato.aplicado` v1 contra el esquema compartido.

El consumidor NO puede conformarse con mirar `evento`, `version` y tenant:
ese error ya se pagó en el consumidor v2 de Suscripciones, donde un sobre con
tres campos recibía ACK sin `id`, `correlation_id`, `ocurrido_en` ni `datos`.
Acá se valida el sobre completo y se elige el esquema por `(evento, version)`.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


NOMBRE_ESQUEMA = Path("shared") / "events" / "candidato-aplicado-v1.schema.json"


def _buscar_esquema(nombre: Path) -> Path:
    """Encuentra el esquema tanto en la imagen como en el repo local."""
    aqui = Path(__file__).resolve()
    for carpeta in [aqui.parent, *aqui.parents]:
        candidato = carpeta / nombre
        if candidato.is_file():
            return candidato
    raise FileNotFoundError(
        f"no se encontró {nombre} subiendo desde {aqui}. "
        "El consumidor no puede validar el contrato sin él."
    )


@functools.lru_cache(maxsize=1)
def validador() -> Draft202012Validator:
    esquema = json.loads(_buscar_esquema(NOMBRE_ESQUEMA).read_text("utf-8"))
    return Draft202012Validator(esquema, format_checker=FormatChecker())


def errores(sobre) -> list[str]:
    """Los incumplimientos del contrato; vacío si el sobre sirve."""
    if not isinstance(sobre, dict):
        return [f"el sobre no es un objeto JSON, es {type(sobre).__name__}"]
    if (sobre.get("evento"), sobre.get("version")) != ("candidato.aplicado", 1):
        return [
            "evento o versión sin esquema: "
            f"{sobre.get('evento')!r} v{sobre.get('version')!r}"
        ]
    fallos = sorted(validador().iter_errors(sobre), key=lambda e: list(e.path))
    return [
        f"{'.'.join(str(p) for p in e.path) or '(raíz)'}: {e.message}" for e in fallos
    ]

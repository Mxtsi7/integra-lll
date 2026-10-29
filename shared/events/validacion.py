"""Valida un sobre contra el contrato MX-21 v2.

Usa **el mismo archivo** que el check `intercambio` de la CI,
[mx21-v2.schema.json](mx21-v2.schema.json), y no una copia de las reglas
escrita a mano: dos definiciones del contrato se desincronizan sin que nada
avise, que es exactamente lo que pasó con la routing key (ver
[contrato.py](contrato.py)).

Vive acá y no dentro de un servicio porque la validación la hacen los DOS
lados —el productor antes de publicar, el consumidor antes de cualquier
efecto— y el contrato es uno.

── Por qué no alcanza con mirar evento, versión y tenant ───────────────────
La primera versión de esto, dentro de Subscriptions, comprobaba que el sobre
fuera un objeto, que el evento y la versión estuvieran admitidos, y que
`organizacion_id` fuera un UUID. Con eso, un sobre de **solo esos tres
campos** pasaba y el consumidor lo confirmaba: faltaban `id`,
`correlation_id`, `ocurrido_en` y `datos`, que el esquema exige. Lo reprodujo
la revisión de la PR.

El `id` importa especialmente: es lo que el catálogo designa para descartar
duplicados. Un sobre sin `id` que recibe ACK es un evento que nadie puede
rastrear, y el inbox de MX-21 no tiene con qué deduplicarlo.

── `format: uuid` y `format: date-time` ────────────────────────────────────
Sin `FormatChecker`, `jsonschema` **ignora** los `format` y un
`"organizacion_id": "no-soy-un-uuid"` pasa. Hay que pasarlo explícitamente.

Y no alcanza con pasarlo: `date-time` necesita `rfc3339-validator` instalado
o jsonschema **acepta en silencio** una fecha inválida. De ahí el extra en
requirements (`jsonschema[format]`, no `jsonschema` a secas). Los `format:
uuid` sí se validan sin el extra, así que el síntoma es parcial y engaña: la
validación parece correr.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


#: El esquema está al lado de este archivo, en `shared/events/`. Se resuelve
#: contra `__file__` y no contra el directorio de trabajo porque esto corre
#: desde la carpeta de cada servicio (`services/notifications/`, …) y también
#: dentro de la imagen, donde `shared/` quedó en `/app/shared/`.
RUTA_ESQUEMA = Path(__file__).resolve().parent / "mx21-v2.schema.json"


@functools.lru_cache(maxsize=1)
def validador() -> Draft202012Validator:
    """El validador, cargado una sola vez.

    Perezoso y no al importar el módulo: las topologías importan de acá en
    cadena, y leer un archivo del disco al importar hace que cualquier error
    de despliegue aparezca como un ImportError incomprensible en vez de donde
    corresponde.
    """
    if not RUTA_ESQUEMA.is_file():
        raise FileNotFoundError(
            f"no se encontró {RUTA_ESQUEMA}. Sin el esquema no se puede "
            "validar el contrato, y sin validar no se hace ningún efecto."
        )
    esquema = json.loads(RUTA_ESQUEMA.read_text("utf-8"))
    return Draft202012Validator(esquema, format_checker=FormatChecker())


def errores(sobre) -> list[str]:
    """Los incumplimientos del contrato, en texto. Vacío si cumple.

    Devuelve todos y no solo el primero: cuando un productor manda un sobre
    mal armado, saber que le faltan cuatro campos ahorra cuatro rondas.
    """
    if not isinstance(sobre, dict):
        return [f"el sobre no es un objeto JSON, es {type(sobre).__name__}"]
    fallos = sorted(validador().iter_errors(sobre), key=lambda e: list(e.path))
    return [
        f"{'.'.join(str(p) for p in e.path) or '(raíz)'}: {e.message}" for e in fallos
    ]

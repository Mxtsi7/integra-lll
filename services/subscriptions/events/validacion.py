"""Valida un sobre contra el contrato MX-21 v2 compartido.

Usa **el mismo archivo** que el check `intercambio` de la CI,
`shared/events/mx21-v2.schema.json`, y no una copia de las reglas escrita a
mano: dos definiciones del contrato se desincronizan sin que nada avise, que
es exactamente lo que pasó con la routing key.

── Por qué no alcanzaba con mirar evento, versión y tenant ──────────────────
La primera versión de `validar()` comprobaba que el sobre fuera un objeto, que
el evento y la versión estuvieran admitidos, y que `organizacion_id` fuera un
UUID. Con eso, un sobre de **solo esos tres campos** pasaba y el consumidor lo
confirmaba: faltaban `id`, `correlation_id`, `ocurrido_en` y `datos`, que el
esquema compartido exige. Lo reprodujo la revisión de la PR.

El `id` importa especialmente: es lo que el catálogo designa para descartar
duplicados. Un sobre sin `id` que recibe ACK es un evento que nadie puede
rastrear.

── `format: uuid` y `format: date-time` ─────────────────────────────────────
Sin `FormatChecker`, `jsonschema` **ignora** los `format` y un
`"organizacion_id": "no-soy-un-uuid"` pasa. Hay que pasarlo explícitamente; el
paquete viene con los extras (`jsonschema[format]` en requirements.txt).
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


NOMBRE_ESQUEMA = Path("shared") / "events" / "mx21-v2.schema.json"


def _buscar_esquema() -> Path:
    """Encuentra el esquema compartido subiendo desde este archivo.

    Hace falta buscar porque vive en dos sitios distintos:

      · en la imagen, `COPY shared/ ./shared/` lo deja en /app/shared/events/
      · corriendo local o en CI, está en la raíz del repo

    Subir hasta encontrarlo cubre los dos sin tener que configurar una ruta
    que después nadie mantiene.
    """
    aqui = Path(__file__).resolve()
    for carpeta in [aqui.parent, *aqui.parents]:
        candidato = carpeta / NOMBRE_ESQUEMA
        if candidato.is_file():
            return candidato
    raise FileNotFoundError(
        f"no se encontró {NOMBRE_ESQUEMA} subiendo desde {aqui}. "
        "El consumidor no puede validar el contrato sin él."
    )


@functools.lru_cache(maxsize=1)
def validador() -> Draft202012Validator:
    """El validador, cargado una sola vez.

    Se carga perezosamente y no al importar el módulo: `topologia` importa de
    acá en cadena, y leer un archivo del disco al importar hace que cualquier
    error de despliegue aparezca como un ImportError incomprensible en vez de
    donde corresponde.
    """
    esquema = json.loads(_buscar_esquema().read_text("utf-8"))
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

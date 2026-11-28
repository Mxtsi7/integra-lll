"""Valida un sobre contra el esquema compartido que le corresponde.

Los eventos MX-21 v2 se validan contra `mx21-v2.schema.json`, el MISMO archivo
que usa el check `intercambio` de la CI. `candidato.confirmado` v1 usa su propio
esquema con la misma envoltura. Los dos se eligen por `(evento, version)`: un
v3 no se valida en silencio con el esquema de v2.

── Por qué no alcanzaba con mirar evento, versión y tenant ──────────────────
La primera versión de `validar()` comprobaba que el sobre fuera un objeto, que
el evento y la versión estuvieran admitidos, y que `organizacion_id` fuera un
UUID. Con eso, un sobre de solo esos tres campos pasaba y el consumidor lo
confirmaba: faltaban `id`, `correlation_id`, `ocurrido_en` y `datos`, que el
esquema compartido exige. Lo reprodujo la revisión de la PR.

El `id` importa especialmente: es lo que el catálogo designa para descartar
duplicados. Un sobre sin `id` que recibe ACK es un evento que nadie puede
rastrear.

── `format: uuid` y `format: date-time` ─────────────────────────────────────
Sin `FormatChecker`, `jsonschema` ignora los `format` y un
`"organizacion_id": "no-soy-un-uuid"` pasaba. Se configura a propósito; el
paquete viene con los extras (`jsonschema[format]` en requirements.txt).
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


NOMBRE_ESQUEMA = Path("shared") / "events" / "mx21-v2.schema.json"
NOMBRE_ESQUEMA_CONFIRMADO = (
    Path("shared") / "events" / "candidato-confirmado-v1.schema.json"
)


def _buscar_esquema(nombre: Path) -> Path:
    """Encuentra el esquema compartido subiendo desde este archivo.

    Hace falta buscar porque vive en dos sitios distintos:

      · en la imagen, `COPY shared/ ./shared/` lo deja en /app/shared/events/
      · corriendo local o en CI, está en la raíz del repo

    Subir hasta encontrarlo cubre los dos sin tener que configurar una ruta
    que después nadie mantiene.
    """
    aqui = Path(__file__).resolve()
    for carpeta in [aqui.parent, *aqui.parents]:
        candidato = carpeta / nombre
        if candidato.is_file():
            return candidato
    raise FileNotFoundError(
        f"no se encontró {nombre} subiendo desde {aqui}. "
        "El consumidor no puede validar el contrato sin él."
    )


def _cargar(nombre: Path) -> Draft202012Validator:
    esquema = json.loads(_buscar_esquema(nombre).read_text("utf-8"))
    return Draft202012Validator(esquema, format_checker=FormatChecker())


@functools.lru_cache(maxsize=1)
def validador() -> Draft202012Validator:
    """El validador v2, cargado una sola vez y de forma perezosa."""
    return _cargar(NOMBRE_ESQUEMA)


@functools.lru_cache(maxsize=1)
def validador_confirmado() -> Draft202012Validator:
    """El validador de `candidato.confirmado` v1."""
    return _cargar(NOMBRE_ESQUEMA_CONFIRMADO)


VALIDADORES = {
    ("suscripcion.creada", 2): validador,
    ("suscripcion.actualizada", 2): validador,
    ("suscripcion.estado_cambiado", 2): validador,
    ("alerta.activada", 2): validador,
    ("candidato.confirmado", 1): validador_confirmado,
}


def validador_para(evento, version):
    """Devuelve el validador o None si nadie reclama esa combinación."""
    return VALIDADORES.get((evento, version))


def errores(sobre) -> list[str]:
    """Los incumplimientos del contrato, en texto. Vacío si cumple.

    Devuelve todos y no solo el primero: cuando un productor manda un sobre
    mal armado, saber que le faltan cuatro campos ahorra cuatro rondas.
    """
    if not isinstance(sobre, dict):
        return [f"el sobre no es un objeto JSON, es {type(sobre).__name__}"]
    fabrica = validador_para(sobre.get("evento"), sobre.get("version"))
    if fabrica is None:
        return [
            f"evento o versión sin esquema: "
            f"{sobre.get('evento')!r} v{sobre.get('version')!r}"
        ]
    fallos = sorted(fabrica().iter_errors(sobre), key=lambda e: list(e.path))
    return [
        f"{'.'.join(str(p) for p in e.path) or '(raíz)'}: {e.message}" for e in fallos
    ]

"""VI-16: `shared/` no puede llevar URLs internas ni de entorno.

El código compartido lo importan la web, el móvil y los servicios. Si ahí
apareciera `http://analytics:8004` o un `localhost:8000`, la app móvil lo
heredaría: `localhost` en un teléfono es el teléfono, y los nombres de
contenedor ni siquiera resuelven fuera de Docker. Las URLs se configuran en
cada cliente (ver `frontend/movil/src/config/api.ts`).
"""

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]

PATRONES_PROHIBIDOS = {
    re.compile(r"https?://localhost(?::\d+)?"): "localhost",
    re.compile(r"https?://127\.0\.0\.1(?::\d+)?"): "127.0.0.1",
    re.compile(r"https?://[a-z][a-z0-9_-]*:\d{4,5}"): "nombre de contenedor con puerto",
    re.compile(r"https?://(?:analytics|auth|subscriptions|connectors|notifications|gateway|postgres|rabbitmq|redis)\b"): "host interno de Docker",
}


def _archivos_compartidos():
    for archivo in (RAIZ / "shared").rglob("*.py"):
        if "tests" in archivo.parts or "__pycache__" in archivo.parts:
            continue
        yield archivo


def test_shared_no_contiene_urls_internas():
    hallazgos = []
    for archivo in _archivos_compartidos():
        texto = archivo.read_text(encoding="utf-8")
        for numero, linea in enumerate(texto.splitlines(), start=1):
            for patron, motivo in PATRONES_PROHIBIDOS.items():
                if patron.search(linea):
                    hallazgos.append(
                        f"{archivo.relative_to(RAIZ)}:{numero} ({motivo}): {linea.strip()}"
                    )
    assert not hallazgos, (
        "shared/ debe recibir la URL como parámetro, no traerla escrita:\n"
        + "\n".join(hallazgos)
    )

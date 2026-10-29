#!/usr/bin/env python3
"""VI-13: verifica estáticamente que Compose levante todo el sistema.

No necesita el daemon de Docker: `docker compose config` sólo valida y
normaliza el YAML. Si el CLI no está instalado, cae a leer `docker-compose.yml`
con PyYAML. Comprueba lo que un `up` saludable exige:

  · están los 6 servicios HTTP, los 3 workers y la infraestructura;
  · cada servicio HTTP tiene un healthcheck que pega a /health/;
  · ningún `depends_on: service_healthy` apunta a algo sin healthcheck;
  · el gateway espera a los 6 servicios de dominio;
  · los workers esperan al servicio que aplica las migraciones.

Uso:
    python scripts/verificar_compose.py
    python scripts/verificar_compose.py --archivo docker-compose.yml
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parents[1]

SERVICIOS_HTTP = {
    "gateway": 8000,
    "auth": 8001,
    "subscriptions": 8002,
    "connectors": 8003,
    "analytics": 8004,
    "notifications": 8005,
}
TRABAJADORES = {
    "subscriptions-worker": "subscriptions",
    "subscriptions-beat": "subscriptions",
    "connectors-worker": "connectors",
    "analytics-worker": "analytics",
}
INFRAESTRUCTURA = {"postgres", "rabbitmq", "redis"}
SIN_HEALTHCHECK_PERMITIDO = {"subscriptions-beat"}  # beat no expone canal de consulta


class Fallo(Exception):
    pass


def cargar(archivo: Path) -> dict[str, Any]:
    if shutil.which("docker"):
        resultado = subprocess.run(
            ["docker", "compose", "--env-file", str(RAIZ / ".env"), "-f", str(archivo),
             "config", "--format", "json"],
            cwd=RAIZ, capture_output=True, text=True,
        )
        if resultado.returncode == 0:
            return json.loads(resultado.stdout)
        # Sin .env o con el daemon apagado se intenta el YAML directo.
        print(f"aviso: docker compose config falló: {resultado.stderr.strip()[:200]}")
    try:
        import yaml  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depende del entorno
        raise Fallo(
            "No se pudo validar: falta PyYAML y `docker compose config` no funciona."
        ) from exc
    datos = yaml.safe_load(archivo.read_text(encoding="utf-8")) or {}
    return datos


def tiene_healthcheck(servicio: dict[str, Any]) -> bool:
    """Cualquier healthcheck real (HTTP, pg_isready, celery ping…)."""
    healthcheck = servicio.get("healthcheck") or {}
    if healthcheck.get("disable"):
        return False
    return bool(healthcheck.get("test"))


def healthcheck_http(servicio: dict[str, Any]) -> bool:
    """Healthcheck HTTP del propio servicio, apuntando a /health/."""
    healthcheck = servicio.get("healthcheck") or {}
    prueba = healthcheck.get("test")
    return tiene_healthcheck(servicio) and "/health/" in " ".join(
        str(parte) for parte in (prueba if isinstance(prueba, list) else [prueba])
    )


def verificar(datos: dict[str, Any]) -> list[str]:
    servicios = datos.get("services") or {}
    errores: list[str] = []

    faltantes = (set(SERVICIOS_HTTP) | set(TRABAJADORES) | INFRAESTRUCTURA) - set(servicios)
    if faltantes:
        errores.append(f"Faltan servicios en Compose: {', '.join(sorted(faltantes))}")

    for nombre, puerto in SERVICIOS_HTTP.items():
        servicio = servicios.get(nombre)
        if not servicio:
            continue
        if not healthcheck_http(servicio):
            errores.append(f"{nombre}: sin healthcheck HTTP real hacia /health/")
        puertos = [str(p) for p in servicio.get("ports") or []]
        if not any(str(puerto) in p for p in puertos):
            errores.append(f"{nombre}: no publica el puerto {puerto} ({puertos})")

    for nombre in TRABAJADORES:
        servicio = servicios.get(nombre)
        if not servicio:
            continue
        healthcheck = servicio.get("healthcheck") or {}
        if nombre in SIN_HEALTHCHECK_PERMITIDO:
            if not healthcheck.get("disable"):
                errores.append(
                    f"{nombre}: debe declarar healthcheck.disable=true (no finge salud)"
                )
        elif not healthcheck.get("test"):
            errores.append(f"{nombre}: worker sin healthcheck")

    # Toda dependencia "service_healthy" debe tener healthcheck.
    for nombre, servicio in servicios.items():
        dependencias = servicio.get("depends_on") or {}
        if isinstance(dependencias, list):
            continue
        for dependencia, condiciones in dependencias.items():
            condicion = (condiciones or {}).get("condition")
            if condicion != "service_healthy":
                continue
            destino = servicios.get(dependencia)
            if not destino:
                errores.append(f"{nombre}: depende de {dependencia}, que no existe")
            elif not tiene_healthcheck(destino):
                errores.append(
                    f"{nombre}: espera service_healthy de {dependencia}, "
                    "que no tiene healthcheck válido"
                )

    gateway = servicios.get("gateway") or {}
    esperados = set(SERVICIOS_HTTP) - {"gateway"}
    gateway_deps = set((gateway.get("depends_on") or {}).keys())
    if esperados - gateway_deps:
        errores.append(
            "gateway no espera a: " + ", ".join(sorted(esperados - gateway_deps))
        )

    for worker, servicio_que_migra in TRABAJADORES.items():
        deps = set(((servicios.get(worker) or {}).get("depends_on") or {}).keys())
        if servicio_que_migra not in deps:
            errores.append(
                f"{worker}: no espera a {servicio_que_migra} (podría correr sin migrar)"
            )

    return errores


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--archivo", type=Path, default=RAIZ / "docker-compose.yml",
        help="Ruta del docker-compose.yml",
    )
    opciones = parser.parse_args()

    try:
        datos = cargar(opciones.archivo)
    except Fallo as exc:
        print(f"FALLO: {exc}")
        return 2

    errores = verificar(datos)
    if errores:
        print("FALLO: Compose no está listo para un arranque saludable:")
        for error in errores:
            print(f"  · {error}")
        return 1

    total = len(datos.get("services") or {})
    print(f"OK: {total} servicios, healthchecks y dependencias coherentes.")
    for nombre, puerto in SERVICIOS_HTTP.items():
        print(f"  · {nombre:15} http://localhost:{puerto}/health/")
    return 0


if __name__ == "__main__":
    sys.exit(main())

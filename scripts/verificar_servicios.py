#!/usr/bin/env python3
"""VI-13: comprueba que el sistema completo esté realmente en pie.

No basta con que `docker compose up` no falle: cada servicio HTTP tiene que
responder su `/health/` (que toca base/Redis) y el gateway tiene que enrutar
hacia los servicios de dominio. Este script espera a que todo esté sano,
opcionalmente levanta o reinicia el stack, y falla con un mensaje concreto.

Con Compose (D-11) sólo gateway y web publican puerto: los dominios se
consultan con `docker compose exec` dentro de su contenedor. El modo
`--sin-compose` mantiene las comprobaciones HTTP contra puertos publicados,
por ejemplo con un override local que los exponga en 127.0.0.1.

Uso típico:

    # con el stack ya levantado
    python scripts/verificar_servicios.py

    # arranque limpio desde cero y espera a que todo esté sano
    python scripts/verificar_servicios.py --compose-up

    # prueba de reinicio (VI-13): reinicia y vuelve a esperar
    python scripts/verificar_servicios.py --compose-restart

    # sin Docker (por ejemplo desde un equipo que sólo consume el backend)
    python scripts/verificar_servicios.py --sin-compose --timeout 30

Sale con 0 si todo está sano y con 1 si algo no responde. El daemon de Docker
no es obligatorio para el modo de sólo healthchecks.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib import error, request

RAIZ = Path(__file__).resolve().parents[1]

SERVICIOS = {
    "gateway": 8000,
    "auth": 8001,
    "subscriptions": 8002,
    "connectors": 8003,
    "analytics": 8004,
    "notifications": 8005,
}

# Servicios que Compose debe mostrar "running" o "healthy". Se enumeran todos
# los de docker-compose.yml: si falta uno, el stack está incompleto aunque los
# healthchecks HTTP respondan. `test_verificar_servicios.py` compara este
# inventario con Compose para que una omisión no vuelva a pasar inadvertida.
CONTENEDORES_ESPERADOS = set(SERVICIOS) | {
    "postgres",
    "rabbitmq",
    "redis",
    "subscriptions-worker",
    "subscriptions-beat",
    "connectors-worker",
    "analytics-worker",
    # Procesa las eliminaciones durables (main). Compose le desactiva el
    # healthcheck porque no expone un canal de consulta; igualmente debe
    # existir y estar corriendo.
    "auth-eliminaciones",
    # La web no tiene healthcheck (no expone /health/): sólo se exige que
    # esté corriendo. Se cuenta igual para detectar un stack incompleto.
    "frontend",
}

# Servicios sin healthcheck a propósito: se exige presencia y ejecución, pero
# no `healthy`. Cualquier otro servicio que no reporte salud se considera
# incompleto. `redis` no declara healthcheck en Compose; su disponibilidad se
# comprueba indirectamente con el `/health/` de los servicios que lo usan.
SIN_HEALTHCHECK = {"subscriptions-beat", "auth-eliminaciones", "frontend", "redis"}


@dataclass
class Resultado:
    servicio: str
    url: str
    ok: bool
    detalle: str


def _leer(url: str, timeout: float) -> tuple[bool, str]:
    """GET sin credenciales. Devuelve (ok, detalle legible)."""
    peticion = request.Request(url, headers={"Accept": "application/json"})
    try:
        with request.urlopen(peticion, timeout=timeout) as respuesta:
            cuerpo = respuesta.read().decode("utf-8", "replace").strip()
            if respuesta.status != 200:
                return False, f"HTTP {respuesta.status}"
            return True, cuerpo[:120] or "200"
    except error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except (error.URLError, TimeoutError, OSError) as exc:
        motivo = getattr(exc, "reason", exc)
        return False, f"sin respuesta ({motivo})"


def _leer_en_contenedor(nombre: str, timeout: float) -> tuple[bool, str]:
    """GET /health/ dentro del contenedor, sin publicar su puerto (D-11)."""
    comando = [
        "docker", "compose", "exec", "-T", nombre,
        "curl", "-fsS", f"http://localhost:{SERVICIOS[nombre]}/health/",
    ]
    try:
        resultado = subprocess.run(
            comando,
            cwd=RAIZ,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"sin respuesta ({exc})"
    if resultado.returncode != 0:
        detalle = (resultado.stderr or resultado.stdout).strip()
        return False, f"curl falló ({detalle[:120] or resultado.returncode})"
    cuerpo = (resultado.stdout or "").strip()
    return True, cuerpo[:120] or "200"


def _comprobar_gateway_enruta(base: str, timeout: float) -> tuple[bool, str]:
    """Sin token, /api/usuarios/me/ debe dar 401 a través del gateway.

    Un 200 sería peor que un fallo: significaría que el gateway dejó pasar una
    ruta privada sin sesión. Un 404/500 indicaría que el proxy no enruta.
    """
    url = f"{base}/api/usuarios/me/"
    peticion = request.Request(url, headers={"Accept": "application/json"})
    try:
        with request.urlopen(peticion, timeout=timeout) as respuesta:
            return False, f"HTTP {respuesta.status} (¡ruta privada sin token!)"
    except error.HTTPError as exc:
        if exc.code == 401:
            return True, "401 sin token (proxy y validación JWT activos)"
        return False, f"HTTP {exc.code} (se esperaba 401)"
    except (error.URLError, TimeoutError, OSError) as exc:
        return False, f"sin respuesta ({getattr(exc, 'reason', exc)})"


def _esperar(
    timeout_total: float,
    comprobar,
    describir,
    intervalo: float = 2.0,
) -> list[Resultado]:
    """Reintenta `comprobar(nombre, timeout)` hasta que todos respondan.

    `comprobar` devuelve `(url, ok, detalle)`; `describir(nombre)` da la URL
    que se muestra si un servicio nunca llegó a comprobarse.
    """
    limite = time.monotonic() + timeout_total
    pendientes = set(SERVICIOS)
    ultimo: dict[str, Resultado] = {}

    while pendientes and time.monotonic() < limite:
        for nombre in list(pendientes):
            timeout = min(5.0, max(1.0, limite - time.monotonic()))
            url, ok, detalle = comprobar(nombre, timeout)
            ultimo[nombre] = Resultado(nombre, url, ok, detalle)
            if ok:
                pendientes.discard(nombre)
        if pendientes:
            time.sleep(intervalo)

    resultados = []
    for nombre in SERVICIOS:
        resultados.append(
            ultimo.get(
                nombre,
                Resultado(nombre, describir(nombre), False,
                          "no se alcanzó a comprobar"),
            )
        )
    return resultados


def esperar(base: str, timeout_total: float, intervalo: float = 2.0) -> list[Resultado]:
    """Comprueba los puertos publicados en el host (`--sin-compose`)."""

    def describir(nombre: str) -> str:
        return f"{base}:{SERVICIOS[nombre]}/health/"

    def comprobar(nombre: str, timeout: float) -> tuple[str, bool, str]:
        url = describir(nombre)
        ok, detalle = _leer(url, timeout)
        return url, ok, detalle

    return _esperar(timeout_total, comprobar, describir, intervalo)


def esperar_en_contenedores(timeout_total: float, intervalo: float = 2.0) -> list[Resultado]:
    """Comprueba `/health/` dentro de cada contenedor (D-11).

    Con Compose sólo gateway y web publican puerto. Los dominios se alcanzan
    por su red interna, así que se consulta el mismo endpoint desde dentro.
    """

    def describir(nombre: str) -> str:
        return f"docker compose exec {nombre} http://localhost:{SERVICIOS[nombre]}/health/"

    def comprobar(nombre: str, timeout: float) -> tuple[str, bool, str]:
        ok, detalle = _leer_en_contenedor(nombre, timeout)
        return describir(nombre), ok, detalle

    return _esperar(timeout_total, comprobar, describir, intervalo)


def ejecutar_compose(argumentos: list[str], timeout: float = 900.0) -> None:
    if not shutil.which("docker"):
        raise SystemExit("FALLO: docker no está en el PATH (usar --sin-compose).")
    comando = ["docker", "compose", *argumentos]
    print(">> " + " ".join(comando))
    resultado = subprocess.run(comando, cwd=RAIZ, text=True)
    if resultado.returncode != 0:
        raise SystemExit(
            f"FALLO: `{' '.join(comando)}` terminó con {resultado.returncode}."
        )


def estado_compose(timeout: float = 60.0) -> list[str]:
    """Lee `docker compose ps` y devuelve los problemas encontrados."""
    if not shutil.which("docker"):
        return ["docker no está en el PATH"]
    try:
        resultado = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            cwd=RAIZ,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return [f"no se pudo consultar docker compose ps: {exc}"]

    if resultado.returncode != 0:
        detalle = (resultado.stderr or resultado.stdout).strip()
        return [f"docker compose ps falló: {detalle[:200]}"]

    contenedores: dict[str, dict] = {}
    for linea in resultado.stdout.splitlines():
        linea = linea.strip()
        if not linea:
            continue
        try:
            datos = json.loads(linea)
        except json.JSONDecodeError:
            continue
        nombre = datos.get("Service") or datos.get("Name")
        if nombre:
            contenedores[str(nombre)] = datos

    problemas: list[str] = []
    for nombre in sorted(CONTENEDORES_ESPERADOS):
        datos = contenedores.get(nombre)
        if datos is None:
            problemas.append(f"{nombre}: no está creado (¿stack incompleto?)")
            continue
        estado = str(datos.get("State", "")).lower()
        if estado not in {"running", "up"}:
            problemas.append(f"{nombre}: estado {estado or '?'}")
            continue
        if nombre in SIN_HEALTHCHECK:
            continue
        salud = str(datos.get("Health", "") or "").lower()
        if salud and salud not in {"healthy"}:
            problemas.append(f"{nombre}: health={salud}")
    return problemas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base", default="http://localhost",
        help="Host base de los puertos publicados en modo --sin-compose "
             "(default: http://localhost)",
    )
    parser.add_argument(
        "--timeout", type=float, default=180.0,
        help="Segundos totales de espera (default: 180)",
    )
    parser.add_argument(
        "--sin-compose", action="store_true",
        help="No consultar ni operar Docker; sólo comprobar /health/",
    )
    parser.add_argument(
        "--compose-up", action="store_true",
        help="Ejecutar `docker compose up -d --build` antes de esperar",
    )
    parser.add_argument(
        "--compose-restart", action="store_true",
        help="Ejecutar `docker compose restart` antes de esperar",
    )
    opciones = parser.parse_args()

    base = opciones.base.rstrip("/")

    if not opciones.sin_compose:
        if not shutil.which("docker"):
            raise SystemExit("FALLO: docker no está en el PATH (usar --sin-compose).")
        if opciones.compose_up:
            ejecutar_compose(["up", "-d", "--build"])
        if opciones.compose_restart:
            ejecutar_compose(["restart"])

    if opciones.sin_compose:
        print(
            f">> esperando /health/ en {base}:8000-8005 "
            f"(puertos publicados; máx. {opciones.timeout:.0f}s)"
        )
        resultados = esperar(base, opciones.timeout)
    else:
        print(
            ">> esperando /health/ dentro de los contenedores "
            f"(D-11; máx. {opciones.timeout:.0f}s)"
        )
        resultados = esperar_en_contenedores(opciones.timeout)

    for resultado in resultados:
        marca = "OK  " if resultado.ok else "FALLO"
        print(f"  [{marca}] {resultado.servicio:14} {resultado.url}  {resultado.detalle}")

    fallos = [r for r in resultados if not r.ok]
    if fallos:
        print(f"\nFALLO: {len(fallos)} servicio(s) sin /health/ sano.")
        return 1

    ruta_ok, ruta_detalle = _comprobar_gateway_enruta(base, timeout=10)
    print(f"  [{'OK  ' if ruta_ok else 'FALLO'}] gateway→auth     {ruta_detalle}")
    if not ruta_ok:
        print("\nFALLO: el gateway no está enrutando/validando como se espera.")
        return 1

    if not opciones.sin_compose:
        problemas = estado_compose()
        if problemas:
            print("\nFALLO: contenedores fuera de estado esperado:")
            for problema in problemas:
                print(f"  · {problema}")
            return 1
        print(f"  [OK  ] compose         {len(CONTENEDORES_ESPERADOS)} contenedores presentes")

    print("\nOK: sistema completo sano (6 servicios HTTP, workers e infraestructura).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

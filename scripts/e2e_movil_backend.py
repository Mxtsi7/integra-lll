#!/usr/bin/env python3
"""VI-16: E2E real app móvil ↔ backend, sólo por el gateway.

Recorre lo que la app hace contra el backend, sin mocks ni acceso directo a
los servicios internos:

  1. GET  /health/                    el gateway está vivo
  2. POST /api/auth/login/            credenciales → access + refresh
  3. GET  /api/usuarios/me/           endpoint protegido con el access
  4. POST /api/auth/refresh/          rotación: access + refresh NUEVOS
  5. GET  /api/usuarios/me/           el access renovado también sirve
  6. POST /api/auth/refresh/          reutilizar el refresh VIEJO → 401
  7. GET  /api/usuarios/me/           token inventado → 401

Nunca imprime tokens: sólo longitudes y los códigos HTTP. El refresh viejo se
reutiliza al final porque el backend cierra la familia de tokens (MX-29); si se
hiciera antes, los pasos siguientes fallarían con 401 por diseño.

Uso:

    # contra el stack local (host de desarrollo)
    python scripts/e2e_movil_backend.py

    # contra el backend visto desde la LAN, como lo verá el teléfono
    python scripts/e2e_movil_backend.py --desde-movil \
        --url http://192.168.1.20:8000/api

Variables: E2E_API_URL, E2E_CORREO, E2E_CLAVE (o los flags --url/--correo/--clave).
Las credenciales por defecto son las del seed de desarrollo; no son secretos.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from urllib import error, parse, request

URL_POR_DEFECTO = "http://localhost:8000/api"
CORREO_POR_DEFECTO = "demo@ojoalgasto.cl"
CLAVE_POR_DEFECTO = "Demo-2026-ojo"
HOSTS_DEL_TELEFONO = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


class Fallo(Exception):
    """Error de contrato: el mensaje ya explica qué se esperaba."""


@dataclass
class Respuesta:
    status: int
    datos: object
    texto: str


def _pedir(metodo: str, url: str, *, cuerpo: object | None = None,
           token: str | None = None, timeout: float = 15.0) -> Respuesta:
    cabeceras = {"Accept": "application/json"}
    if cuerpo is not None:
        cabeceras["Content-Type"] = "application/json"
    if token:
        cabeceras["Authorization"] = f"Bearer {token}"
    datos = None if cuerpo is None else json.dumps(cuerpo).encode("utf-8")
    peticion = request.Request(url, data=datos, headers=cabeceras, method=metodo)
    try:
        with request.urlopen(peticion, timeout=timeout) as respuesta:
            texto = respuesta.read().decode("utf-8", "replace")
            return Respuesta(respuesta.status, _json(texto), texto)
    except error.HTTPError as exc:
        texto = exc.read().decode("utf-8", "replace")
        return Respuesta(exc.code, _json(texto), texto)
    except error.URLError as exc:
        raise Fallo(f"no se pudo contactar {url}: {getattr(exc, 'reason', exc)}") from exc
    except (TimeoutError, OSError) as exc:
        raise Fallo(f"sin respuesta de {url}: {exc}") from exc


def _json(texto: str) -> object:
    try:
        return json.loads(texto) if texto.strip() else None
    except json.JSONDecodeError:
        return None


def _exigir(condicion: bool, mensaje: str) -> None:
    if not condicion:
        raise Fallo(mensaje)


def _tokens(respuesta: Respuesta, paso: str) -> tuple[str, str]:
    _exigir(respuesta.status == 200, f"{paso}: se esperaba 200, llegó {respuesta.status}")
    _exigir(isinstance(respuesta.datos, dict), f"{paso}: el cuerpo no es un objeto JSON")
    access = respuesta.datos.get("access_token")
    refresh = respuesta.datos.get("refresh_token")
    _exigir(isinstance(access, str) and access, f"{paso}: falta access_token")
    _exigir(isinstance(refresh, str) and refresh, f"{paso}: falta refresh_token")
    return access, refresh


def _validar_url(url: str, desde_movil: bool, produccion: bool) -> str:
    partes = parse.urlsplit(url)
    _exigir(partes.scheme in {"http", "https"}, "la URL debe usar http:// o https://")
    _exigir(not partes.username and not partes.password,
            "la URL no puede llevar usuario:contraseña")
    _exigir(not partes.query and not partes.fragment,
            "la URL no puede llevar query string ni fragmento")
    _exigir(partes.path.rstrip("/") == "/api",
            "la URL debe terminar en /api (base del gateway)")
    if desde_movil:
        host = (partes.hostname or "").lower()
        _exigir(host not in HOSTS_DEL_TELEFONO,
                f"{host} en un teléfono es el propio teléfono; usa la IP LAN "
                "o http://10.0.2.2:8000/api en el emulador Android")
    if produccion:
        _exigir(partes.scheme == "https", "en producción la app sólo usa https")
    return url.rstrip("/")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("E2E_API_URL", URL_POR_DEFECTO))
    parser.add_argument("--correo", default=os.environ.get("E2E_CORREO", CORREO_POR_DEFECTO))
    parser.add_argument("--clave", default=os.environ.get("E2E_CLAVE", CLAVE_POR_DEFECTO))
    parser.add_argument("--desde-movil", action="store_true",
                        help="Exigir una URL alcanzable desde un teléfono (sin localhost)")
    parser.add_argument("--produccion", action="store_true",
                        help="Exigir https, como en una build de producción")
    opciones = parser.parse_args()

    try:
        base = _validar_url(opciones.url, opciones.desde_movil, opciones.produccion)
        print(f">> backend: {base}")

        print("1. gateway /health/")
        salud = _pedir("GET", base.removesuffix("/api") + "/health/")
        _exigir(salud.status == 200, f"gateway /health/ respondió {salud.status}")

        print("2. login")
        login = _pedir("POST", f"{base}/auth/login/",
                       cuerpo={"email": opciones.correo, "password": opciones.clave})
        access, refresh = _tokens(login, "login")
        print(f"   OK  access={len(access)} chars, refresh={len(refresh)} chars")

        print("3. endpoint protegido con el access")
        perfil = _pedir("GET", f"{base}/usuarios/me/", token=access)
        _exigir(perfil.status == 200, f"/usuarios/me/ respondió {perfil.status}")
        _exigir(isinstance(perfil.datos, dict) and perfil.datos.get("id"),
                "/usuarios/me/ no devolvió el usuario")

        print("4. refresh con rotación")
        renovado = _pedir("POST", f"{base}/auth/refresh/",
                          cuerpo={"refresh_token": refresh})
        access_nuevo, refresh_nuevo = _tokens(renovado, "refresh")
        _exigir(refresh_nuevo != refresh, "el backend no rotó el refresh token")
        print("   OK  refresh nuevo distinto del anterior")

        print("5. endpoint protegido con el access renovado")
        perfil_nuevo = _pedir("GET", f"{base}/usuarios/me/", token=access_nuevo)
        _exigir(perfil_nuevo.status == 200,
                f"/usuarios/me/ con access renovado respondió {perfil_nuevo.status}")

        print("6. reutilizar el refresh viejo")
        reuso = _pedir("POST", f"{base}/auth/refresh/",
                       cuerpo={"refresh_token": refresh})
        _exigir(reuso.status == 401,
                f"reutilizar un refresh rotado debía dar 401, dio {reuso.status}")

        print("7. token inválido")
        invalido = _pedir("GET", f"{base}/usuarios/me/", token="no-es-un-jwt")
        _exigir(invalido.status == 401,
                f"un token inválido debía dar 401, dio {invalido.status}")
    except Fallo as exc:
        print(f"\nFALLO: {exc}", file=sys.stderr)
        return 1

    print("\nOK: login, JWT, endpoint protegido, refresh, reutilización y 401 verificados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

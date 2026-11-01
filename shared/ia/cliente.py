"""Cliente único del asistente de IA (VI-24).

Habla **con el endpoint de Analytics**, nunca con el proveedor externo. El
cliente no conoce la API key ni la URL interna del contenedor: recibe la URL
pública del gateway y el JWT de la sesión. Así una app, un script o un job
comparten la misma política de timeout y de reintento, y no hay un segundo
proxy que se salte la autorización Premium ni las cuotas.

Contrato del endpoint (lo implementa `services/analytics`):

    POST /api/asistente/
    Authorization: Bearer <access>
    {"mensaje": "…"}
    → 200 {"estado": "ok" | "degradado", "motivo": …, "respuesta": "…", "datos": {…}}
    → 401/403/503 con {"detail": "…"}
"""

from __future__ import annotations

import json
import socket
from urllib import error, request

from .politica import TIMEOUT_MAXIMO_SEGUNDOS, validar_timeout


class ErrorAsistente(Exception):
    """Error controlado del cliente: no expone la respuesta cruda del gateway."""

    def __init__(
        self,
        mensaje: str,
        *,
        status: int | None = None,
        codigo: str = "error",
    ) -> None:
        super().__init__(mensaje)
        self.status = status
        self.codigo = codigo


class ClienteAsistente:
    """Cliente síncrono con timeout y reintento acotado.

    Reintenta solo cuando el fallo es transitorio (429/503). Un 401 o un 403
    no se reintentan: insistir con las mismas credenciales no cambia el
    resultado y multiplicaría llamadas que consumen cuota.
    """

    def __init__(
        self,
        url_base: str,
        token: str | None = None,
        *,
        timeout: float = TIMEOUT_MAXIMO_SEGUNDOS,
        reintentos: int = 1,
    ) -> None:
        if not isinstance(url_base, str) or not url_base.strip():
            raise ValueError("Falta la URL pública del backend (gateway).")
        if not isinstance(reintentos, int) or reintentos < 0 or reintentos > 2:
            raise ValueError("Los reintentos deben estar entre 0 y 2.")
        self.url = url_base.rstrip("/") + "/asistente/"
        self.token = token
        self.timeout = validar_timeout(timeout)
        self.reintentos = reintentos

    def consultar(self, mensaje: str = "") -> dict:
        if not isinstance(mensaje, str):
            raise ValueError("El mensaje debe ser texto.")
        cuerpo = json.dumps({"mensaje": mensaje[:500]}).encode("utf-8")
        cabeceras = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.token:
            cabeceras["Authorization"] = f"Bearer {self.token}"

        ultimo: ErrorAsistente | None = None
        for intento in range(self.reintentos + 1):
            try:
                return self._una_vez(cuerpo, cabeceras)
            except ErrorAsistente as exc:
                ultimo = exc
                if exc.codigo not in {"reintentar", "timeout"} or intento >= self.reintentos:
                    raise
        assert ultimo is not None
        raise ultimo

    def _una_vez(self, cuerpo: bytes, cabeceras: dict[str, str]) -> dict:
        peticion = request.Request(
            self.url, data=cuerpo, headers=cabeceras, method="POST"
        )
        try:
            with request.urlopen(peticion, timeout=self.timeout) as respuesta:
                crudo = respuesta.read().decode("utf-8")
        except error.HTTPError as exc:
            detalle = _detalle_de_error(exc)
            if exc.code in (429, 503):
                raise ErrorAsistente(
                    detalle, status=exc.code, codigo="reintentar"
                ) from exc
            if exc.code in (401, 403):
                raise ErrorAsistente(
                    detalle, status=exc.code, codigo="sin_autorizacion"
                ) from exc
            raise ErrorAsistente(detalle, status=exc.code, codigo="error") from exc
        except (socket.timeout, TimeoutError) as exc:
            raise ErrorAsistente(
                "El asistente no respondió dentro del tiempo permitido.",
                codigo="timeout",
            ) from exc
        except error.URLError as exc:
            if isinstance(exc.reason, (socket.timeout, TimeoutError)):
                raise ErrorAsistente(
                    "El asistente no respondió dentro del tiempo permitido.",
                    codigo="timeout",
                ) from exc
            raise ErrorAsistente(
                "No se pudo contactar al backend. Revisa la URL y la red.",
                codigo="sin_conexion",
            ) from exc
        except OSError as exc:
            raise ErrorAsistente(
                "No se pudo contactar al backend. Revisa la URL y la red.",
                codigo="sin_conexion",
            ) from exc

        try:
            datos = json.loads(crudo)
        except json.JSONDecodeError as exc:
            raise ErrorAsistente(
                "El backend devolvió una respuesta que no es JSON.",
                codigo="respuesta_invalida",
            ) from exc
        if not isinstance(datos, dict) or datos.get("estado") not in {"ok", "degradado"}:
            raise ErrorAsistente(
                "El backend devolvió una respuesta fuera del contrato.",
                codigo="respuesta_invalida",
            )
        return datos


def _detalle_de_error(exc: error.HTTPError) -> str:
    try:
        datos = json.loads(exc.read().decode("utf-8"))
    except (ValueError, OSError):
        return f"El backend respondió {exc.code}."
    if isinstance(datos, dict) and isinstance(datos.get("detail"), str):
        return datos["detail"]
    return f"El backend respondió {exc.code}."

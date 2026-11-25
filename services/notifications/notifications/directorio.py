"""Quiénes son las personas de una organización y su correo, preguntado a auth (S3-FE-21).

Es la fuente de las direcciones de correo de las alertas. Antes había una
tabla `DireccionCorreo` que nadie llenaba (el conflicto entre el catálogo y
MX-21 estaba sin resolver); la revisión de #203 pidió una «fuente
autoritativa con auth», y es esta. La firma y el formato están en
`shared/directorio.py`; la vista, en `services/auth/app/directorio.py`.

── Dónde se usa ─────────────────────────────────────────────────────────────
- `PreferenciaNotificacion.de_la_organizacion`: QUIÉNES son las personas
  (las que planifican entregas y fijan las ventanas del generador).
- `CanalCorreo.destino`: A DÓNDE escribirle a cada una, al momento de
  mandar. Así sale siempre a la dirección vigente, aunque la persona la haya
  cambiado después de que se planificó la entrega.

── Si auth no responde ──────────────────────────────────────────────────────
`DirectorioNoDisponible`. No se inventa nada: ni una lista vacía (que haría
creer que la organización no tiene a nadie), ni la dirección de la última
vez. Quien llama decide: el despacho difiere la entrega, y el generador
falla a la vista y la corrida siguiente lo vuelve a intentar.
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings

from shared import directorio as contrato

log = logging.getLogger(__name__)

#: Conectar y leer. Corto: se llama con filas bloqueadas (ver `entregas.reclamar`).
TIEMPO = (2, 5)


class DirectorioNoDisponible(Exception):
    """auth no entregó la lista. `codigo` dice por qué, sin datos de nadie."""

    def __init__(self, codigo: str, detalle: str = ""):
        super().__init__(f"{codigo}: {detalle}" if detalle else codigo)
        self.codigo = codigo
        self.detalle = detalle


def destinatarios(organizacion_id) -> dict[str, str]:
    """{usuario_id: email} de las personas activas de la organización."""
    try:
        cabeceras = contrato.cabeceras_directorio(organizacion_id)
    except ValueError:
        raise DirectorioNoDisponible("sin_secreto", f"falta {contrato.VARIABLE_SECRETO}") from None
    url = settings.URL_AUTH.rstrip("/") + contrato.ruta(organizacion_id)
    try:
        respuesta = requests.get(url, headers=cabeceras, timeout=TIEMPO, allow_redirects=False)
    except requests.Timeout:
        raise DirectorioNoDisponible("tiempo_agotado") from None
    except requests.RequestException as error:
        raise DirectorioNoDisponible("sin_conexion", type(error).__name__) from None
    if respuesta.status_code != 200:
        # 403: el secreto de los dos lados no coincide. Es configuración, y se
        # ve en el log de las dos partes.
        raise DirectorioNoDisponible(f"respuesta_{respuesta.status_code}")
    try:
        filas = respuesta.json()["destinatarios"]
        resultado = {}
        for fila in filas:
            usuario_id, email = fila["usuario_id"], fila["email"]
            if not isinstance(usuario_id, str) or not isinstance(email, str):
                raise TypeError
            resultado[usuario_id] = email
    except (ValueError, KeyError, TypeError):
        raise DirectorioNoDisponible("respuesta_invalida") from None
    return resultado

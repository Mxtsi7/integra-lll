"""Consulta interna de destinatarios: notifications pregunta a auth (S3-FE-21).

── Para qué ─────────────────────────────────────────────────────────────────
El correo de cada persona vive en el esquema de auth, y ningún servicio lee
el esquema de otro (ADR-002). Para mandar una alerta, notifications necesita
saber quiénes son las personas de una organización y a qué dirección
escribirles. Se lo pregunta a auth en el momento, firmado:

    GET {URL_AUTH}/internal/organizaciones/<organizacion_id>/destinatarios/
    X-Directorio-Instante: <segundos unix>
    X-Directorio-Firma:    hex(HMAC-SHA256(DIRECTORIO_INTERNO_SECRET,
                                "directorio:<organizacion_id>:<instante>"))

    200 {"destinatarios": [{"usuario_id": "12", "email": "ana@ejemplo.cl"}, ...]}

Se eligió esto y no el evento `usuario.creado` con el correo que describe el
catálogo, porque MX-21 prohíbe transportar correos en los eventos, y porque
una copia guardada en notifications se desactualiza cuando la persona cambia
su correo. Lo pidió la revisión de #203: «fuente autoritativa con auth».

── Por qué un secreto propio y no el de la limpieza ────────────────────────
`ELIMINACION_INTERNA_SECRET` autoriza BORRAR organizaciones. Quien tiene este
solo puede LEER direcciones. Si uno se filtra, el otro no.

── La firma ─────────────────────────────────────────────────────────────────
Cubre el destino (`directorio`), la organización y el instante, igual que la
de la limpieza (`shared/eliminacion.py`): una firma de una organización no
sirve para otra, y vence a los 60 segundos. Repetirla dentro de ese plazo
devuelve lo mismo que ya se entregó: la consulta solo lee.

Este módulo no importa Django: lo usan auth (que verifica) y notifications
(que firma).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time

VARIABLE_SECRETO = "DIRECTORIO_INTERNO_SECRET"
CABECERA_INSTANTE = "X-Directorio-Instante"
CABECERA_FIRMA = "X-Directorio-Firma"
#: Cuánto vale una firma, hacia atrás y hacia adelante (relojes desfasados).
VIGENCIA_SEGUNDOS = 60


class FirmaInvalida(ValueError):
    """La solicitud no trae una firma válida y vigente para esa organización."""


def _secreto() -> str:
    return os.environ.get(VARIABLE_SECRETO, "")


def _firma(secreto: str, organizacion_id, instante: str) -> str:
    mensaje = f"directorio:{organizacion_id}:{instante}"
    return hmac.new(secreto.encode(), mensaje.encode(), hashlib.sha256).hexdigest()


def ruta(organizacion_id) -> str:
    return f"/internal/organizaciones/{organizacion_id}/destinatarios/"


def cabeceras_directorio(organizacion_id, *, ahora: float | None = None) -> dict[str, str]:
    """Las cabeceras de una consulta firmada. Sin secreto, ValueError."""
    secreto = _secreto()
    if not secreto:
        raise ValueError(f"{VARIABLE_SECRETO} no configurado")
    instante = str(int(time.time() if ahora is None else ahora))
    return {CABECERA_INSTANTE: instante, CABECERA_FIRMA: _firma(secreto, organizacion_id, instante)}


def verificar(cabeceras, organizacion_id, *, ahora: float | None = None) -> None:
    """Lanza `FirmaInvalida` si la firma no es la de esta organización o venció.

    Sin secreto configurado no se acepta nada: un auth mal configurado no
    puede quedar abierto.
    """
    secreto = _secreto()
    instante = cabeceras.get(CABECERA_INSTANTE, "") or ""
    firma = cabeceras.get(CABECERA_FIRMA, "") or ""
    try:
        desfase = abs((time.time() if ahora is None else ahora) - int(instante))
    except (ValueError, OverflowError):
        raise FirmaInvalida("instante inválido") from None
    if desfase > VIGENCIA_SEGUNDOS:
        raise FirmaInvalida("firma vencida")
    if not secreto or not firma.isascii():
        raise FirmaInvalida("firma inválida")
    if not hmac.compare_digest(_firma(secreto, organizacion_id, instante), firma):
        raise FirmaInvalida("firma inválida")

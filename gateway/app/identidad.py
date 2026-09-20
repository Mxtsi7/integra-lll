"""
Valida el JWT que emitió auth y extrae la identidad (ADR-004).

El contrato del token está en gateway/README.md. Lo esencial:

  - Firmado con JWT_SECRET, algoritmo JWT_ALGORITMO (HS256).
  - `sub` o `user_id`: el id del usuario. Obligatorio.
  - `organizacion_id` y `rol`: opcionales mientras no exista el modelo de
    organización en auth. Si vienen, se propagan; si no, el servicio de
    destino decide (TenantViewSet responde 403 sin organización).
  - `exp`: obligatorio, y se verifica.
"""

import jwt
from django.conf import settings


class TokenInvalido(Exception):
    """Cualquier motivo por el que no se acepta el token. El mensaje va al cliente."""


def leer_token(cabecera_authorization: str | None) -> str:
    if not cabecera_authorization or not cabecera_authorization.startswith("Bearer "):
        raise TokenInvalido("Falta el token: se espera 'Authorization: Bearer <token>'")
    token = cabecera_authorization[len("Bearer "):].strip()
    if not token:
        raise TokenInvalido("Falta el token: se espera 'Authorization: Bearer <token>'")
    return token


def validar(token: str) -> dict:
    """Devuelve la identidad si el token es válido; si no, TokenInvalido."""
    try:
        claims = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITMO],
            options={"require": ["exp"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise TokenInvalido("El token expiró") from e
    except jwt.InvalidTokenError as e:
        raise TokenInvalido("Token inválido") from e

    usuario_id = claims.get("sub") or claims.get("user_id")
    if not usuario_id:
        raise TokenInvalido("El token no identifica al usuario")

    return {
        "usuario_id": str(usuario_id),
        "organizacion_id": claims.get("organizacion_id"),
        "rol": claims.get("rol"),
    }

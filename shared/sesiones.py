"""Versión de credenciales compartida por auth y gateway mediante Redis.

Una clave ausente nunca autoriza una sesión. Así una pérdida de Redis
obliga a iniciar sesión, sin resucitar JWT revocados.
"""

from hmac import compare_digest

from django.conf import settings
from django.core.cache import caches
from django.utils.crypto import salted_hmac


def version_credenciales(usuario):
    return salted_hmac(
        "sesiones.password", usuario.password, secret=settings.JWT_SECRET,
        algorithm="sha256",
    ).hexdigest()


def registrar_credenciales(usuario):
    version = version_credenciales(usuario)
    caches["sesiones"].set(f"usuario:{usuario.pk}", version, timeout=None)
    return version


def sesion_vigente(usuario_id, version):
    if not isinstance(version, str) or len(version) != 64 or not version.isascii():
        return False
    actual = caches["sesiones"].get(f"usuario:{usuario_id}")
    return isinstance(actual, str) and compare_digest(actual, version)


def sesion_activa(usuario_id, version, sesion_id):
    """La ausencia de cualquier registro deniega acceso, también tras perder Redis."""
    from uuid import UUID

    try:
        if str(UUID(str(sesion_id))) != sesion_id:
            return False
    except (ValueError, TypeError):
        return False
    return (
        sesion_vigente(usuario_id, version)
        and caches["sesiones"].get(f"sesion:{sesion_id}") == [str(usuario_id), version]
    )

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied

from .models import User


def usuario_del_contexto(request, *, bloquear=False):
    """Identidad interna emitida por Gateway; nunca se toma un id del cuerpo."""
    identificador = request.headers.get("X-Usuario-Id", "")
    if not identificador.isascii() or not identificador.isdigit() or len(identificador) > 19 or not 0 < int(identificador) <= 2**63 - 1:
        raise PermissionDenied("Falta un contexto de usuario válido")
    usuarios = User.objects.select_for_update() if bloquear else User.objects
    usuario = get_object_or_404(usuarios, pk=identificador, is_active=True)
    organizacion = request.headers.get("X-Organizacion-Id") or None
    if organizacion != (str(usuario.organizacion_id) if usuario.organizacion_id else None):
        raise PermissionDenied("La organización de la sesión no es válida")
    return usuario

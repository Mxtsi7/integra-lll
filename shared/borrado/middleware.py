import uuid

from django.db import transaction
from django.http import JsonResponse

from .bloqueo import bloquear_organizacion


class EscrituraOrganizacionMiddleware:
    """Mantiene el mismo bloqueo que limpieza hasta concluir la escritura HTTP."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        org = request.headers.get("X-Organizacion-Id")
        if request.method in ("GET", "HEAD", "OPTIONS") or not org or not request.path.startswith("/api/"):
            return self.get_response(request)
        try:
            org = uuid.UUID(org)
        except (ValueError, AttributeError):
            return JsonResponse({"code": "organizacion_invalida"}, status=403)
        with transaction.atomic():
            estado = bloquear_organizacion(org)
            if estado.eliminada:
                return JsonResponse({"code": "organizacion_eliminada"}, status=410)
            # Una respuesta 400 puede confirmar un cambio deliberado, como
            # consumir un state OAuth cuyo canje falló. La vista controla sus
            # propias transacciones; el middleware solo serializa con limpieza.
            return self.get_response(request)

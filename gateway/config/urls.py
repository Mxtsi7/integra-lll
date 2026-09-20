from django.conf import settings
from django.http import JsonResponse
from django.urls import path, re_path

from app.proxy import reenviar


def salud(request):
    """Lo consulta el HEALTHCHECK del Dockerfile. El gateway no tiene base: responder ya es estar sano."""
    return JsonResponse({"servicio": settings.NOMBRE_SERVICIO, "estado": "ok"})


urlpatterns = [
    path("health/", salud),
    # Todo lo demás bajo /api/ se reenvía al servicio que corresponda.
    re_path(r"^api/", reenviar),
]

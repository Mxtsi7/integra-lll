from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def salud(request):
    """
    Lo consulta el HEALTHCHECK del Dockerfile. Toca la base a propósito:
    un servicio que no llega a su esquema no está sano, aunque responda.
    """
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_schema()")
        esquema = cursor.fetchone()[0]
    return JsonResponse(
        {"servicio": settings.NOMBRE_SERVICIO, "esquema": esquema, "estado": "ok"}
    )


urlpatterns = [
    path("health/", salud),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
]

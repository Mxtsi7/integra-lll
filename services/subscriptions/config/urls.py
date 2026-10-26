from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from app.views import SubscriptionViewSet
from app.eliminacion import LimpiezaSubscriptionsView

router = DefaultRouter()
router.register(r"suscripciones", SubscriptionViewSet, basename="subscription")

def salud(request):
    """
    Lo consulta el HEALTHCHECK del Dockerfile. Toca la base a propósito:
    un servicio que no llega a su esquema no está sano, aunque responda.
    """
    with connection.cursor() as cursor:
        if connection.vendor == "sqlite":
            esquema = settings.ESQUEMA_BD
        else:
            cursor.execute("SELECT current_schema()")
            esquema = cursor.fetchone()[0]
    return JsonResponse(
        {"servicio": settings.NOMBRE_SERVICIO, "esquema": esquema, "estado": "ok"}
    )


from app.catalogos_api import CatalogosSuscripcionesView

urlpatterns = [
    path("internal/organizaciones/<uuid:organizacion_id>/", LimpiezaSubscriptionsView.as_view()),
    path("api/catalogos/suscripciones/", CatalogosSuscripcionesView.as_view()),
    path("health/", salud),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/", include(router.urls)),
]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r"uso-mensual", views.UsoMensualViewSet, basename="uso-mensual")

urlpatterns = [
    path("health/", views.health_check, name="health_check"),
    # Va antes del include por lo mismo que en connectors: el detalle del
    # router acepta cualquier segmento sin barra como pk.
    path("puntajes-uso/", views.PuntajesUsoView.as_view(), name="puntajes-uso"),
    path("", include(router.urls)),
]

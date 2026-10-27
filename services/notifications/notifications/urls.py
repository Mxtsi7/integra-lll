from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AlertaViewSet

router = DefaultRouter()
# "alertas", en español: el gateway enruta /api/alertas/ y reenvía la ruta
# intacta (ADR-004). Si acá dijera "notifications", la petición llegaría al
# servicio y moriría en un 404 que no se ve desde afuera.
router.register(r"alertas", AlertaViewSet, basename="alerta")

urlpatterns = [
    path("", include(router.urls)),
]

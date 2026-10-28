from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AlertaViewSet, PreferenciasNotificacionView

router = DefaultRouter()
# "alertas", en español: el gateway enruta /api/alertas/ y reenvía la ruta
# intacta (ADR-004). Si acá dijera "notifications", la petición llegaría al
# servicio y moriría en un 404 que no se ve desde afuera.
router.register(r"alertas", AlertaViewSet, basename="alerta")

urlpatterns = [
    # Va antes del include por lo mismo que en connectors: el detalle del
    # router acepta cualquier segmento sin barra como pk, así que
    # "alertas/<algo>" se lo comería si la ruta específica fuera después.
    # Acá el prefijo es distinto, pero se mantiene el orden por costumbre.
    path(
        "preferencias-alertas/",
        PreferenciasNotificacionView.as_view(),
        name="preferencias-alertas",
    ),
    path("", include(router.urls)),
]

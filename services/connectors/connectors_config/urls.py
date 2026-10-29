from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from connectors.views import salud
from connectors.eliminacion import LimpiezaConnectorsView

urlpatterns = [
    path("internal/organizaciones/<uuid:organizacion_id>/", LimpiezaConnectorsView.as_view()),
    path("health/", salud, name="health"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    # Sin prefijo extra: el router ya registra "conectores", así que esto
    # queda en /api/conectores/. El gateway reenvía esa ruta tal cual.
    path("api/", include("connectors.urls")),
]

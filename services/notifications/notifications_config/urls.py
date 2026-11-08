from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from notifications.views import salud
from notifications.eliminacion import LimpiezaNotificationsView, LimpiezaUsuarioNotificationsView

urlpatterns = [
    path("internal/organizaciones/<uuid:organizacion_id>/usuarios/<int:usuario_id>/", LimpiezaUsuarioNotificationsView.as_view()),
    path("internal/organizaciones/<uuid:organizacion_id>/", LimpiezaNotificationsView.as_view()),
    path("health/", salud, name="health"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    # Sin prefijo extra: el router ya registra "alertas", así que esto queda
    # en /api/alertas/. El gateway reenvía esa ruta tal cual.
    path("api/", include("notifications.urls")),
]

from django.contrib import admin
from django.urls import path, include

from connectors.views import health_check
from connectors.eliminacion import LimpiezaConnectorsView

urlpatterns = [
    path("internal/organizaciones/<uuid:organizacion_id>/", LimpiezaConnectorsView.as_view()),
    path('health/', health_check, name='health'),
    path('admin/', admin.site.urls),
    path('api/connectors/', include('connectors.urls')),
]

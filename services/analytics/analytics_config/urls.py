from django.contrib import admin
from django.urls import path, include

from analytics.views import health_check
from analytics.eliminacion import LimpiezaAnalyticsView

urlpatterns = [
    path("internal/organizaciones/<uuid:organizacion_id>/", LimpiezaAnalyticsView.as_view()),
    path('health/', health_check, name='health'),
    path('admin/', admin.site.urls),
    path('api/analytics/', include('analytics.urls')),
]

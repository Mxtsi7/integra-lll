from django.contrib import admin
from django.urls import path, include

from analytics.views import health_check, recomendaciones_list

urlpatterns = [
    path('health/', health_check, name='health'),
    path('admin/', admin.site.urls),
    # El gateway reenvía la ruta sin traducirla: /api/recomendaciones/ debe
    # existir tal cual en este servicio (gateway/config/settings.py, RUTAS).
    path('api/recomendaciones/', recomendaciones_list, name='recomendaciones_list'),
    path('api/analytics/', include('analytics.urls')),
]

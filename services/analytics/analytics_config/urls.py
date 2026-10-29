from django.contrib import admin
from django.urls import path, include

from analytics.views import (
    asistente,
    health_check,
    recomendaciones_dismiss,
    recomendaciones_list,
)

urlpatterns = [
    path('health/', health_check, name='health'),
    path('admin/', admin.site.urls),
    # El gateway reenvía la ruta sin traducirla: /api/asistente/ debe existir
    # tal cual en este servicio (gateway/config/settings.py, RUTAS).
    path('api/asistente/', asistente, name='asistente'),
    # El gateway reenvía la ruta sin traducirla: /api/recomendaciones/ debe
    # existir tal cual en este servicio (gateway/config/settings.py, RUTAS).
    path('api/recomendaciones/', recomendaciones_list, name='recomendaciones_list'),
    path(
        'api/recomendaciones/<str:pk>/dismiss/',
        recomendaciones_dismiss,
        name='recomendaciones_dismiss',
    ),
    path('api/analytics/', include('analytics.urls')),
    # En español, que es lo que rutea el gateway (ADR-004). La de arriba
    # queda por compatibilidad: no está en RUTAS, o sea que desde afuera
    # nunca fue alcanzable.
    path('api/analitica/', include('analytics.urls')),
]

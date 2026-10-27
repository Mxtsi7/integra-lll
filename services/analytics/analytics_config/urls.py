from django.contrib import admin
from django.urls import path, include

from analytics.views import health_check

urlpatterns = [
    path('health/', health_check, name='health'),
    path('admin/', admin.site.urls),
    path('api/analytics/', include('analytics.urls')),
    # En español, que es lo que rutea el gateway (ADR-004). La de arriba
    # queda por compatibilidad: no está en RUTAS, o sea que desde afuera
    # nunca fue alcanzable.
    path('api/analitica/', include('analytics.urls')),
]

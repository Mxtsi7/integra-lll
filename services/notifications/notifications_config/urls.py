from django.contrib import admin
from django.urls import path, include

from notifications.views import health_check

urlpatterns = [
    path('health/', health_check, name='health'),
    path('admin/', admin.site.urls),
    path('api/notifications/', include('notifications.urls')),
]

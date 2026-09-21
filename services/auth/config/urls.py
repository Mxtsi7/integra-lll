from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from app.views import RegisterView


def salud(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"status": "ok"})


def inicio(request):
    return JsonResponse({"mensaje": "Servicio Auth activo"})


urlpatterns = [
    path("health/", salud),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("", inicio),
    path("admin/", admin.site.urls),
]

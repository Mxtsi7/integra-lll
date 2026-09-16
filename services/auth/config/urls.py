from django.contrib import admin
from django.http import HttpResponse, JsonResponse
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def salud(request):
    return JsonResponse({"servicio": "auth", "estado": "ok"})


def inicio(request):
    return HttpResponse("Servicio auth corriendo en el puerto 8001 ✅")


urlpatterns = [
    path("health/", salud),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("", inicio),
    path("admin/", admin.site.urls),
]

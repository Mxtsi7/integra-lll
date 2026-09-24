from django.contrib import admin
from django.db import connection
from django.http import HttpResponse, JsonResponse
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from app.views import RegisterView, LoginView, UserDetailView


def salud(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_schema()")
        esquema = cursor.fetchone()[0]
    return JsonResponse(
        {
            "servicio": "auth",
            "estado": "ok",
            "esquema": esquema,
        }
    )


def inicio(request):
    return HttpResponse("Servicio Auth activo")


from app.views import RegisterView, UserDetailView

urlpatterns = [
    path("health/", salud),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("api/auth/login/", LoginView.as_view(), name="login"),
    path("api/usuarios/<int:pk>/", UserDetailView.as_view(), name="user-detail"),
    path("", inicio),
    path("admin/", admin.site.urls),
]

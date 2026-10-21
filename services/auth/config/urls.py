from django.contrib import admin
from django.db import connection
from django.http import HttpResponse, JsonResponse
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from app.views import (
    ConfirmacionRecuperacionView,
    LoginView,
    OrganizacionView,
    RegisterView,
    SolicitudRecuperacionView,
    UserDetailView,
    UsuarioActualView,
)
from app.sesiones import LogoutView, RefreshView
from app.perfil import CambioClaveView


def salud(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_schema()")
        esquema = cursor.fetchone()[0]
    return JsonResponse({"servicio": "auth", "estado": "ok", "esquema": esquema})


def inicio(request):
    return HttpResponse("Servicio Auth activo")


from app.catalogos_api import PaisesView

urlpatterns = [
    path("api/catalogos/paises/", PaisesView.as_view()),
    path("health/", salud),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("api/auth/login/", LoginView.as_view(), name="login"),
    path("api/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/auth/refresh/", RefreshView.as_view(), name="refresh"),
    path("api/auth/change-password/", CambioClaveView.as_view(), name="change-password"),
    path(
        "api/auth/password-reset/",
        SolicitudRecuperacionView.as_view(),
        name="password-reset",
    ),
    path(
        "api/auth/password-reset/confirm/",
        ConfirmacionRecuperacionView.as_view(),
        name="password-reset-confirm",
    ),
    path("api/usuarios/me/", UsuarioActualView.as_view(), name="usuario-actual"),
    path("api/organizacion/", OrganizacionView.as_view(), name="organizacion"),
    path("api/usuarios/<int:pk>/", UserDetailView.as_view(), name="usuario-detalle"),
    path("", inicio),
    path("admin/", admin.site.urls),
]

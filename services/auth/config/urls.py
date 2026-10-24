from django.contrib import admin
from django.db import connection
from django.http import HttpResponse, JsonResponse
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from app.google_login import GoogleLoginView, GoogleNonceView

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
from app.permisos_plan import PermisosPlanView, PlanesView
from app.contrataciones import ContratacionesView, ContratacionDetalleView, CancelarContratacionView, WebhookPagoView, CheckoutMockView
from app.verificacion_correo_api import ConfirmacionVerificacionView, SolicitudVerificacionView


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

    path("api/contrataciones/", ContratacionesView.as_view(), name="contrataciones"),
    path("api/contrataciones/<uuid:pk>/", ContratacionDetalleView.as_view(), name="contratacion-detalle"),
    path("api/contrataciones/<uuid:pk>/cancelar/", CancelarContratacionView.as_view(), name="contratacion-cancelar"),
    path("api/pagos/webhook/", WebhookPagoView.as_view(), name="webhook-pago"),
    path("api/pagos/mock/", CheckoutMockView.as_view(), name="checkout-mock"),
    path("api/planes/", PlanesView.as_view(), name="planes"),
    path("api/usuarios/me/permisos/", PermisosPlanView.as_view(), name="permisos-plan"),
    path("health/", salud),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("api/auth/login/", LoginView.as_view(), name="login"),
    path("api/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/auth/refresh/", RefreshView.as_view(), name="refresh"),
    path("api/auth/change-password/", CambioClaveView.as_view(), name="change-password"),
    path("api/auth/email-verification/request/", SolicitudVerificacionView.as_view(), name="email-verification-request"),
    path("api/auth/email-verification/confirm/", ConfirmacionVerificacionView.as_view(), name="email-verification-confirm"),
    path("api/auth/google/nonce/", GoogleNonceView.as_view(), name="google-nonce"),
    path("api/auth/google/", GoogleLoginView.as_view(), name="google-login"),
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

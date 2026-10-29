from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CallbackAutorizacionView,
    CuentaConectadaViewSet,
    ImportacionViewSet,
    IniciarAutorizacionView,
)

router = DefaultRouter()
# "conectores", en español: el gateway enruta /api/conectores/ y reenvía la
# ruta intacta (ADR-004). Si acá dijera "connectors", la petición llegaría al
# servicio y moriría en un 404 que no se ve desde afuera.
router.register(r"conectores", CuentaConectadaViewSet, basename="cuenta-conectada")
# "importaciones", en español, por lo mismo: el gateway reenvía la ruta
# intacta y un nombre en inglés moriría en un 404 invisible desde afuera.
router.register(r"importaciones", ImportacionViewSet, basename="importacion")

# ── El orden importa ─────────────────────────────────────────────────
# El router arma la ruta de detalle como `conectores/<pk>/`, y el lookup por
# omisión de DRF es `[^/.]+`: acepta cualquier cosa que no tenga barra ni
# punto. O sea que `conectores/autorizaciones/` CALZA con el detalle, y si el
# include del router fuera primero, la petición se iría a `retrieve` con
# pk="autorizaciones" y moriría en un 404 raro en vez de llegar acá.
#
# Por eso las rutas de OAuth van ANTES del include. Django resuelve con la
# primera que calza, así que las específicas tienen que ir arriba.
urlpatterns = [
    path(
        "conectores/autorizaciones/",
        IniciarAutorizacionView.as_view(),
        name="iniciar-autorizacion",
    ),
    path(
        "conectores/autorizaciones/callback/",
        CallbackAutorizacionView.as_view(),
        name="callback-autorizacion",
    ),
    path("", include(router.urls)),
]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CallbackAutorizacionView,
    CobroCandidatoViewSet,
    CuentaConectadaViewSet,
    ImportacionViewSet,
    IniciarAutorizacionView,
    SubirArchivoView,
)

router = DefaultRouter()
# "conectores", en español: el gateway enruta /api/conectores/ y reenvía la
# ruta intacta (ADR-004). Si acá dijera "connectors", la petición llegaría al
# servicio y moriría en un 404 que no se ve desde afuera.
router.register(r"conectores", CuentaConectadaViewSet, basename="cuenta-conectada")
# "importaciones", en español, por lo mismo: el gateway reenvía la ruta
# intacta y un nombre en inglés moriría en un 404 invisible desde afuera.
router.register(r"importaciones", ImportacionViewSet, basename="importacion")
# S3-FE-14: los candidatos que la vista previa muestra antes de confirmar.
# Ruta propia y no anidada bajo `importaciones/`: S3-CH-04 lista los de los
# DOS orígenes juntos, y los de correo no vienen de una importación de
# archivo. Colgarlos de `importaciones/<id>/candidatos/` obligaría a pedirlos
# archivo por archivo y dejaría los de correo sin dónde vivir.
#
# OJO: el gateway enruta por prefijo, así que esta ruta necesita su entrada en
# `RUTAS` (gateway/config/settings.py) o desde afuera es un 404.
router.register(r"candidatos", CobroCandidatoViewSet, basename="cobro-candidato")

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
    # Va ANTES del include del router: `importaciones/<pk>/` aceptaria
    # "archivos" como pk y moriria en un 404 raro (ver el comentario de
    # arriba sobre el lookup de DRF).
    path(
        "importaciones/archivos/",
        SubirArchivoView.as_view(),
        name="subir-archivo-importacion",
    ),
    path("", include(router.urls)),
]

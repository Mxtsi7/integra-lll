from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CuentaConectadaViewSet, ImportacionViewSet, SubirArchivoView

router = DefaultRouter()
# "conectores", en español: el gateway enruta /api/conectores/ y reenvía la
# ruta intacta (ADR-004). Si acá dijera "connectors", la petición llegaría al
# servicio y moriría en un 404 que no se ve desde afuera.
router.register(r"conectores", CuentaConectadaViewSet, basename="cuenta-conectada")
# "importaciones", en español, por lo mismo: el gateway reenvía la ruta
# intacta y un nombre en inglés moriría en un 404 invisible desde afuera.
router.register(r"importaciones", ImportacionViewSet, basename="importacion")

urlpatterns = [
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

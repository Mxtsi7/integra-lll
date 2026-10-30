import pytest
from django.urls import resolve


@pytest.mark.parametrize(
    ("ruta", "vista"),
    [
        (
            "/internal/organizaciones/11111111-1111-1111-1111-111111111111/",
            "LimpiezaSubscriptionsView",
        ),
        ("/api/hallazgos/", "HallazgoCobroViewSet"),
        ("/api/hallazgos/1/", "HallazgoCobroViewSet"),
        ("/api/export/cobros/", "ExportarCobrosCSVView"),
    ],
)
def test_integracion_conserva_rutas_de_limpieza_y_main(ruta, vista):
    assert resolve(ruta).func.cls.__name__ == vista

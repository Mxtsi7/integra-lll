import pytest
from django.contrib.contenttypes.models import ContentType

from analytics.models import RecomendacionConsolidacion, UmbralAhorro


@pytest.mark.django_db
def test_migraciones_y_conexion_real():
    # Analytics persiste recomendaciones y umbrales en su propio esquema;
    # comprobar la infraestructura real sin consultar el esquema de otro
    # servicio.
    assert ContentType.objects.filter(app_label="contenttypes", model="contenttype").exists()
    assert RecomendacionConsolidacion.objects.count() == 0
    assert UmbralAhorro.objects.count() == 0

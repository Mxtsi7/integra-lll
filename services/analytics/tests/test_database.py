import pytest
from django.contrib.contenttypes.models import ContentType


@pytest.mark.django_db
def test_migraciones_y_conexion_real():
    # Analytics aún no persiste snapshots: comprobar la infraestructura real
    # sin inventar un modelo ni consultar el esquema de otro servicio.
    assert ContentType.objects.filter(app_label="contenttypes", model="contenttype").exists()

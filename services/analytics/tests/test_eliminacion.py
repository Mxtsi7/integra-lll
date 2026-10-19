import uuid

import pytest
from rest_framework.test import APIClient

from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion


@pytest.mark.django_db
def test_ack_analytics_persiste_marca_aunque_no_haya_modelos_de_dominio(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, operacion = uuid.uuid4(), uuid.uuid4()
    firma = cabeceras_eliminacion("analytics", org, operacion)
    respuesta = APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )
    assert respuesta.status_code == 204
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada

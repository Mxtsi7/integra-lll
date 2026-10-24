import uuid

import pytest
from rest_framework.test import APIClient

from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion
from notifications.models import Alerta


@pytest.mark.django_db
def test_ack_notifications_persiste_marca_aunque_no_haya_modelos_de_dominio(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, operacion = uuid.uuid4(), uuid.uuid4()
    firma = cabeceras_eliminacion("notifications", org, operacion)
    respuesta = APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )
    assert respuesta.status_code == 204
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada


@pytest.mark.django_db
def test_limpieza_borra_alertas_sin_tocar_otra_organizacion(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    for tenant in (org, otra):
        Alerta.objects.create(
            organizacion_id=tenant, tipo=Alerta.Tipo.PROXIMO_COBRO,
            titulo="Cobro", mensaje="Aviso", evento_id=uuid.uuid4(),
        )
    for _ in range(2):
        firma = cabeceras_eliminacion("notifications", org, operacion)
        respuesta = APIClient().delete(
            f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
            **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
        )
        assert respuesta.status_code == 204
    assert not Alerta.objects.filter(organizacion_id=org).exists()
    assert Alerta.objects.filter(organizacion_id=otra).count() == 1

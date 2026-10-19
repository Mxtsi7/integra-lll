import uuid

import pytest
from rest_framework.test import APIClient

from connectors.models import CuentaConectada
from shared.eliminacion import cabeceras_eliminacion
from shared.borrado.models import EstadoOrganizacion

pytestmark = pytest.mark.django_db


def limpiar(org):
    operacion = uuid.uuid4()
    firma = cabeceras_eliminacion("connectors", org, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )


def test_csv_se_elimina_sin_tocar_otro_tenant(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    propia = CuentaConectada.objects.create(organizacion_id=org, proveedor="csv", cuenta_externa="cartola")
    ajena = CuentaConectada.objects.create(organizacion_id=otra, proveedor="csv", cuenta_externa="cartola")
    assert limpiar(org).status_code == 204
    assert limpiar(org).status_code == 204
    assert not CuentaConectada.objects.filter(pk=propia.pk).exists()
    assert CuentaConectada.objects.filter(pk=ajena.pk).exists()


def test_revocacion_externa_pendiente_conserva_token_cifrado_para_reintento(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="gmail", cuenta_externa="prueba@test.cl", refresh_token="token-prueba",
    )
    assert limpiar(org).status_code == 409
    cuenta.refresh_from_db()
    assert cuenta.estado == CuentaConectada.Estado.DESCONECTADA
    assert cuenta.refresh_token == "token-prueba"
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    # Simula únicamente el registro posterior a un ACK real del adaptador FE-05.
    from django.utils import timezone
    cuenta.revocado_en = timezone.now()
    cuenta.save(update_fields=["revocado_en"])
    assert limpiar(org).status_code == 204
    assert not CuentaConectada.objects.filter(pk=cuenta.pk).exists()


def test_ausencia_de_tokens_no_demuestra_revocacion_externa(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(organizacion_id=org, proveedor="outlook", cuenta_externa="prueba@test.cl")
    assert limpiar(org).status_code == 409
    assert CuentaConectada.objects.filter(pk=cuenta.pk).exists()

import uuid

import pytest
from rest_framework.test import APIClient

from connectors.models import AutorizacionPendiente, CuentaConectada, Importacion
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


def test_csv_se_elimina_sin_tocar_otro_tenant(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    propia = CuentaConectada.objects.create(organizacion_id=org, proveedor="csv", cuenta_externa="cartola")
    ajena = CuentaConectada.objects.create(organizacion_id=otra, proveedor="csv", cuenta_externa="cartola")
    for tenant, cuenta in ((org, propia), (otra, ajena)):
        AutorizacionPendiente.abrir(
            organizacion_id=tenant, usuario_id="42", proveedor="gmail",
            redirect_uri="https://example.com/callback",
        )
        Importacion.objects.create(
            organizacion_id=tenant, usuario_id="42", origen="correo", cuenta=cuenta,
        )
        Importacion.objects.create(organizacion_id=tenant, usuario_id="42", origen="csv")
    assert limpiar(org).status_code == 204
    assert limpiar(org).status_code == 204
    assert not CuentaConectada.objects.filter(pk=propia.pk).exists()
    assert CuentaConectada.objects.filter(pk=ajena.pk).exists()
    assert not Importacion.objects.filter(organizacion_id=org).exists()
    assert Importacion.objects.filter(organizacion_id=otra).count() == 2
    assert not AutorizacionPendiente.objects.filter(organizacion_id=org).exists()
    assert AutorizacionPendiente.objects.filter(organizacion_id=otra).count() == 1


def test_fk_de_importacion_ajena_bloquea_sin_modificar_datos(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="csv", cuenta_externa="cartola",
    )
    importacion = Importacion.objects.create(
        organizacion_id=otra, usuario_id="42", origen="correo", cuenta=cuenta,
    )
    assert limpiar(org).status_code == 409
    importacion.refresh_from_db()
    assert importacion.cuenta_id == cuenta.pk
    assert CuentaConectada.objects.filter(pk=cuenta.pk).exists()
    assert not EstadoOrganizacion.objects.filter(organizacion_id=org, eliminada=True).exists()


def test_revocacion_externa_pendiente_conserva_token_cifrado_para_reintento(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    estado = EstadoOrganizacion.objects.create(organizacion_id=org)
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="gmail", cuenta_externa="prueba@test.cl", refresh_token="token-prueba",
    )
    assert limpiar(org).status_code == 409
    cuenta.refresh_from_db()
    assert cuenta.estado == CuentaConectada.Estado.CONECTADA
    assert cuenta.refresh_token == "token-prueba"
    estado.refresh_from_db()
    assert not estado.eliminada
    assert estado.operacion_id is None
    assert limpiar(org).status_code == 409
    # Simula únicamente el registro posterior a un ACK real del adaptador FE-05.
    from django.utils import timezone
    cuenta.revocado_en = timezone.now()
    cuenta.save(update_fields=["revocado_en"])
    assert limpiar(org).status_code == 204
    estado.refresh_from_db()
    assert estado.eliminada
    assert not CuentaConectada.objects.filter(pk=cuenta.pk).exists()


def test_ausencia_de_tokens_no_demuestra_revocacion_externa(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(organizacion_id=org, proveedor="outlook", cuenta_externa="prueba@test.cl")
    assert limpiar(org).status_code == 409
    assert CuentaConectada.objects.filter(pk=cuenta.pk).exists()

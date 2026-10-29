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
    monkeypatch.setattr("connectors.proveedores.revocar", lambda *args, **kwargs: False)
    assert limpiar(org).status_code == 409
    cuenta.refresh_from_db()
    assert cuenta.estado == CuentaConectada.Estado.CONECTADA
    assert cuenta.refresh_token == "token-prueba"
    estado.refresh_from_db()
    assert not estado.eliminada
    assert estado.operacion_id is None
    assert limpiar(org).status_code == 409
    # Se usa el adaptador real de FE-05; solo el proveedor externo tiene doble.
    monkeypatch.setattr("connectors.proveedores.revocar", lambda *args, **kwargs: True)
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


def test_gmail_confirmado_se_conserva_aunque_outlook_bloquee(monkeypatch, claves):
    from unittest.mock import Mock
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    gmail = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="gmail", cuenta_externa="gmail@test.cl", refresh_token="gmail-token",
    )
    outlook = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="outlook", cuenta_externa="outlook@test.cl", access_token="outlook-token",
    )
    revocar = Mock(side_effect=lambda proveedor, **kwargs: proveedor == "gmail")
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)
    assert limpiar(org).status_code == 409
    gmail.refresh_from_db()
    outlook.refresh_from_db()
    assert gmail.revocado_en is not None and gmail.refresh_token is None
    assert outlook.revocado_en is None and outlook.access_token == "outlook-token"
    assert outlook.estado == CuentaConectada.Estado.CONECTADA
    assert not EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    revocar.reset_mock()
    assert limpiar(org).status_code == 409
    revocar.assert_called_once_with("outlook", access_token="outlook-token")


def test_firma_invalida_no_intenta_revocar(monkeypatch, claves):
    from unittest.mock import Mock
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="gmail", cuenta_externa="gmail@test.cl", refresh_token="token",
    )
    revocar = Mock()
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)
    assert APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(uuid.uuid4())}, format="json",
    ).status_code == 403
    revocar.assert_not_called()
    cuenta.refresh_from_db()
    assert cuenta.refresh_token == "token"


def test_limpieza_con_clave_ilegible_conserva_ciphertext(monkeypatch, claves):
    from shared.cifrado.cifrador import generar_clave
    from shared.cifrado import SECRETO_ILEGIBLE
    from unittest.mock import Mock
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="gmail", cuenta_externa="gmail@test.cl", refresh_token="token",
    )
    claves(generar_clave())
    revocar = Mock()
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)
    assert limpiar(org).status_code == 409
    revocar.assert_not_called()
    cuenta.refresh_from_db()
    assert cuenta.refresh_token is SECRETO_ILEGIBLE and cuenta.revocado_en is None

import logging
import uuid
from contextlib import contextmanager
from unittest.mock import Mock

import pytest
from django.db.models.signals import pre_delete
from django.utils import timezone
from rest_framework.test import APIClient

from connectors.models import AutorizacionPendiente, CuentaConectada, Importacion
from connectors.eliminacion import LimpiezaConnectorsView
from shared.eliminacion import cabeceras_eliminacion
from shared.borrado.models import EstadoOrganizacion

pytestmark = pytest.mark.django_db


def limpiar(org, operacion=None, firma=None):
    operacion = operacion or uuid.uuid4()
    firma = firma or cabeceras_eliminacion("connectors", org, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )


@contextmanager
def capturar_cuentas_al_borrar():
    """Estado final de cada cuenta, capturado justo antes de que se borre."""
    capturadas = []

    def capturar(sender, instance, **kwargs):
        capturadas.append(
            {
                "proveedor": instance.proveedor,
                "estado": instance.estado,
                "revocado_en": instance.revocado_en,
                "access_token": (
                    str(instance.access_token) if instance.access_token else None
                ),
                "refresh_token": (
                    str(instance.refresh_token) if instance.refresh_token else None
                ),
            }
        )

    pre_delete.connect(capturar, sender=CuentaConectada, weak=False)
    try:
        yield capturadas
    finally:
        pre_delete.disconnect(capturar, sender=CuentaConectada)


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


def test_gmail_sin_evidencia_sigue_bloqueando(monkeypatch):
    """La excepción de Outlook no se filtra a un proveedor que sí revoca."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="gmail", cuenta_externa="prueba@test.cl",
    )
    assert limpiar(org).status_code == 409
    assert CuentaConectada.objects.filter(pk=cuenta.pk).exists()
    cuenta.refresh_from_db()
    assert cuenta.revocado_en is None


def test_proveedor_desconocido_bloquea_y_conserva_credenciales(monkeypatch, claves):
    """Un proveedor sin configuración OAuth no puede destruir ciphertext en un 409."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="desconocido",
        cuenta_externa="rara@test.cl",
        access_token="token-raro",
        refresh_token="refresh-raro",
    )
    revocar = Mock()
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)

    assert limpiar(org).status_code == 409

    revocar.assert_not_called()
    cuenta.refresh_from_db()
    assert cuenta.estado == CuentaConectada.Estado.CONECTADA
    assert cuenta.revocado_en is None
    assert cuenta.access_token == "token-raro"
    assert cuenta.refresh_token == "refresh-raro"


def test_firma_invalida_no_intenta_revocar(monkeypatch, claves):
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
    from shared.cifrado import SECRETO_ILEGIBLE
    from shared.cifrado.cifrador import generar_clave

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


def test_outlook_solo_termina_sin_revocacion_y_sin_revocado_en(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="outlook",
        cuenta_externa="outlook@test.cl",
        access_token="outlook-token",
        refresh_token="outlook-refresh",
    )
    revocar = Mock()
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)

    with capturar_cuentas_al_borrar() as capturadas:
        assert limpiar(org).status_code == 204

    revocar.assert_not_called()
    assert not CuentaConectada.objects.filter(pk=cuenta.pk).exists()
    assert capturadas == [
        {
            "proveedor": "outlook",
            "estado": CuentaConectada.Estado.CONECTADA,
            "revocado_en": None,
            "access_token": "outlook-token",
            "refresh_token": "outlook-refresh",
        }
    ]


def test_outlook_con_fk_ajena_bloquea_y_conserva_credenciales(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="outlook",
        cuenta_externa="outlook@test.cl",
        access_token="outlook-token",
        refresh_token="outlook-refresh",
    )
    importacion = Importacion.objects.create(
        organizacion_id=otra, usuario_id="42", origen="correo", cuenta=cuenta,
    )

    assert limpiar(org).status_code == 409

    cuenta.refresh_from_db()
    importacion.refresh_from_db()
    assert cuenta.estado == CuentaConectada.Estado.CONECTADA
    assert cuenta.revocado_en is None
    assert cuenta.access_token == "outlook-token"
    assert cuenta.refresh_token == "outlook-refresh"
    assert importacion.cuenta_id == cuenta.pk
    assert not EstadoOrganizacion.objects.filter(organizacion_id=org, eliminada=True).exists()


def test_fallo_de_gmail_conserva_tambien_outlook_y_luego_termina(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    gmail = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="gmail",
        cuenta_externa="gmail@test.cl",
        access_token="gmail-access",
        refresh_token="gmail-refresh",
    )
    outlook = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="outlook",
        cuenta_externa="outlook@test.cl",
        access_token="outlook-token",
        refresh_token="outlook-refresh",
    )
    revocar = Mock(side_effect=[False, True])
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)
    operacion = uuid.uuid4()

    assert limpiar(org, operacion).status_code == 409

    gmail.refresh_from_db()
    outlook.refresh_from_db()
    assert gmail.estado == CuentaConectada.Estado.CONECTADA
    assert gmail.revocado_en is None
    assert gmail.access_token == "gmail-access"
    assert gmail.refresh_token == "gmail-refresh"
    assert outlook.estado == CuentaConectada.Estado.CONECTADA
    assert outlook.revocado_en is None
    assert outlook.access_token == "outlook-token"
    assert outlook.refresh_token == "outlook-refresh"
    assert revocar.call_count == 1
    assert revocar.call_args.args == ("gmail",)
    assert revocar.call_args.kwargs["access_token"] == "gmail-access"

    assert limpiar(org, operacion).status_code == 204

    assert revocar.call_count == 2
    assert all(call.args == ("gmail",) for call in revocar.call_args_list)
    assert not CuentaConectada.objects.filter(pk=gmail.pk).exists()
    assert not CuentaConectada.objects.filter(pk=outlook.pk).exists()


@pytest.mark.parametrize("cambio", ["reconexion", "cuenta_nueva"])
def test_cambio_outlook_entre_preparacion_y_borrado_conserva_credenciales_nuevas(monkeypatch, claves, cambio):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    operacion = uuid.uuid4()
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org, proveedor="outlook", cuenta_externa="outlook@test.cl",
        access_token="anterior", refresh_token="refresh-anterior",
    )
    preparar = LimpiezaConnectorsView.preparar_limpieza

    def preparar_y_cambiar(self, organizacion_id):
        respuesta = preparar(self, organizacion_id)
        if cambio == "reconexion":
            CuentaConectada.objects.filter(pk=cuenta.pk).update(
                access_token="nuevo", refresh_token="refresh-nuevo",
                credenciales_version=cuenta.credenciales_version + 1,
            )
        else:
            CuentaConectada.objects.create(
                organizacion_id=org, proveedor="outlook", cuenta_externa="nueva@test.cl",
                access_token="nuevo", refresh_token="refresh-nuevo",
            )
        return respuesta

    monkeypatch.setattr(LimpiezaConnectorsView, "preparar_limpieza", preparar_y_cambiar)
    respuesta = limpiar(org, operacion)
    assert respuesta.status_code == 409
    assert respuesta.json()["code"] == "credenciales_cambiadas"
    assert not EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    nueva = CuentaConectada.objects.get(pk=cuenta.pk) if cambio == "reconexion" else CuentaConectada.objects.get(cuenta_externa="nueva@test.cl")
    assert nueva.access_token == "nuevo"
    assert nueva.refresh_token == "refresh-nuevo"
    assert nueva.revocado_en is None
    # La misma operación puede reintentarse sin destruir la concesión nueva
    # durante el 409; el siguiente intento la prepara y completa la limpieza.
    monkeypatch.setattr(LimpiezaConnectorsView, "preparar_limpieza", preparar)
    assert limpiar(org, operacion).status_code == 204


def test_gmail_ya_confirmado_no_se_vuelve_a_revocar_y_outlook_termina(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    gmail = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="gmail",
        cuenta_externa="gmail@test.cl",
        estado=CuentaConectada.Estado.DESCONECTADA,
        revocado_en=timezone.now(),
    )
    outlook = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="outlook",
        cuenta_externa="outlook@test.cl",
        access_token="outlook-token",
        refresh_token="outlook-refresh",
    )
    revocar = Mock()
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)

    with capturar_cuentas_al_borrar() as capturadas:
        assert limpiar(org).status_code == 204

    revocar.assert_not_called()
    por_proveedor = {cuenta["proveedor"]: cuenta for cuenta in capturadas}
    assert por_proveedor["gmail"]["revocado_en"] is not None
    assert por_proveedor["outlook"]["revocado_en"] is None
    assert por_proveedor["outlook"]["access_token"] == "outlook-token"
    assert por_proveedor["outlook"]["refresh_token"] == "outlook-refresh"
    assert not CuentaConectada.objects.filter(pk=gmail.pk).exists()
    assert not CuentaConectada.objects.filter(pk=outlook.pk).exists()


def test_gmail_confirmado_en_la_misma_limpieza_y_outlook_termina(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    gmail = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="gmail",
        cuenta_externa="gmail@test.cl",
        access_token="gmail-access",
        refresh_token="gmail-refresh",
    )
    outlook = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="outlook",
        cuenta_externa="outlook@test.cl",
        access_token="outlook-token",
        refresh_token="outlook-refresh",
    )
    revocar = Mock(return_value=True)
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)

    with capturar_cuentas_al_borrar() as capturadas:
        assert limpiar(org).status_code == 204

    revocar.assert_called_once_with("gmail", access_token="gmail-access")
    por_proveedor = {cuenta["proveedor"]: cuenta for cuenta in capturadas}
    assert por_proveedor["gmail"]["revocado_en"] is not None
    assert por_proveedor["outlook"]["revocado_en"] is None
    assert por_proveedor["outlook"]["access_token"] == "outlook-token"
    assert not CuentaConectada.objects.filter(pk=gmail.pk).exists()
    assert not CuentaConectada.objects.filter(pk=outlook.pk).exists()


def test_revocacion_confirmada_sobrevive_a_un_fallo_con_otra_cuenta(monkeypatch, claves):
    """Google ya revocó la primera: un fallo con la segunda no la devuelve a `conectada`."""
    from django.db import OperationalError

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    cuentas = {
        f"ya29.{letra}": CuentaConectada.objects.create(
            organizacion_id=org, proveedor="gmail",
            cuenta_externa=f"{letra.lower()}@gmail.com", access_token=f"ya29.{letra}",
        )
        for letra in "AB"
    }
    enviados = []

    def revocar(proveedor, *, access_token):
        enviados.append(access_token)
        if len(enviados) == 2:
            raise OperationalError("se cayó la conexión de la petición")
        return True

    monkeypatch.setattr("connectors.proveedores.revocar", revocar)
    with pytest.raises(OperationalError):
        limpiar(org)

    confirmada, interrumpida = (cuentas[token] for token in enviados)
    confirmada.refresh_from_db()
    assert confirmada.revocado_en is not None
    assert confirmada.access_token is None
    assert confirmada.estado == CuentaConectada.Estado.DESCONECTADA
    interrumpida.refresh_from_db()
    assert interrumpida.revocado_en is None
    assert interrumpida.access_token == enviados[1]
    assert interrumpida.estado == CuentaConectada.Estado.CONECTADA

    # El reintento solo le manda al proveedor la que faltaba.
    pendiente = enviados[1]
    enviados.clear()
    monkeypatch.setattr(
        "connectors.proveedores.revocar",
        lambda proveedor, *, access_token: enviados.append(access_token) or True,
    )
    assert limpiar(org).status_code == 204
    assert enviados == [pendiente]
    assert not CuentaConectada.objects.filter(organizacion_id=org).exists()


def test_reentrega_de_la_misma_operacion_no_duplica_efectos(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    operacion = uuid.uuid4()
    firma = cabeceras_eliminacion("connectors", org, operacion)
    cuenta = CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="outlook",
        cuenta_externa="outlook@test.cl",
        access_token="outlook-token",
    )
    revocar = Mock()
    monkeypatch.setattr("connectors.proveedores.revocar", revocar)

    assert limpiar(org, operacion, firma).status_code == 204
    assert limpiar(org, operacion, firma).status_code == 204

    revocar.assert_not_called()
    assert not CuentaConectada.objects.filter(pk=cuenta.pk).exists()
    estado = EstadoOrganizacion.objects.get(organizacion_id=org)
    assert estado.eliminada is True
    assert estado.operacion_id == operacion
    assert EstadoOrganizacion.objects.filter(organizacion_id=org).count() == 1


def test_aislamiento_entre_organizaciones(monkeypatch, claves):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    a = CuentaConectada.objects.create(
        organizacion_id=org_a,
        proveedor="outlook",
        cuenta_externa="a@outlook.cl",
        access_token="token-a",
        refresh_token="refresh-a",
    )
    b = CuentaConectada.objects.create(
        organizacion_id=org_b,
        proveedor="outlook",
        cuenta_externa="b@outlook.cl",
        access_token="token-b",
        refresh_token="refresh-b",
    )

    assert limpiar(org_a).status_code == 204

    assert not CuentaConectada.objects.filter(pk=a.pk).exists()
    b.refresh_from_db()
    assert b.estado == CuentaConectada.Estado.CONECTADA
    assert b.revocado_en is None
    assert b.access_token == "token-b"
    assert b.refresh_token == "refresh-b"


def test_registra_conteo_sin_revocacion_y_no_expone_datos_personales(
    monkeypatch, claves, caplog
):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    CuentaConectada.objects.create(
        organizacion_id=org,
        proveedor="outlook",
        cuenta_externa="persona@outlook.cl",
        access_token="token-secreto",
    )
    caplog.set_level(logging.INFO, logger="connectors.eliminacion")

    assert limpiar(org).status_code == 204

    eventos = [
        registro
        for registro in caplog.records
        if registro.message == "limpieza_connectors_sin_revocacion_proveedor"
    ]
    assert len(eventos) == 1
    evento = eventos[0]
    assert evento.organizacion_id == str(org)
    assert evento.cuentas_sin_revocacion == 1
    assert evento.proveedores_sin_revocacion == ["outlook"]
    assert "persona@outlook.cl" not in caplog.text
    assert "token-secreto" not in caplog.text

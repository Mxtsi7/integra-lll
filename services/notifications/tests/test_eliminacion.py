import uuid

import pytest
from rest_framework.test import APIClient

from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion
from notifications.models import Alerta, PreferenciaNotificacion, UsuarioEliminado


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
        PreferenciaNotificacion.objects.create(organizacion_id=tenant, usuario_id="42")
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
    assert not PreferenciaNotificacion.objects.filter(organizacion_id=org).exists()
    assert PreferenciaNotificacion.objects.filter(organizacion_id=otra).count() == 1


@pytest.mark.django_db
def test_limpieza_personal_firmada_aislada_e_idempotente(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    for tenant, usuario in ((org, "42"), (org, "43"), (otra, "42")):
        PreferenciaNotificacion.objects.create(organizacion_id=tenant, usuario_id=usuario)
    def peticion(tenant, usuario, destino):
        firma = cabeceras_eliminacion(destino, org, operacion)
        return APIClient().delete(
            f"/internal/organizaciones/{tenant}/usuarios/{usuario}/", {"operacion_id": str(operacion)}, format="json",
            **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
        )
    assert peticion(org, 42, "notifications").status_code == 403
    assert peticion(org, 43, "notifications:usuario:42").status_code == 403
    assert peticion(otra, 42, "notifications:usuario:42").status_code == 403
    assert PreferenciaNotificacion.objects.count() == 3
    for _ in range(2):
        assert peticion(org, 42, "notifications:usuario:42").status_code == 204
    assert not PreferenciaNotificacion.objects.filter(organizacion_id=org, usuario_id="42").exists()
    assert PreferenciaNotificacion.objects.filter(organizacion_id=org, usuario_id="43").exists()
    assert PreferenciaNotificacion.objects.filter(organizacion_id=otra, usuario_id="42").exists()
    assert not EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    # Una petición que el Gateway autenticó antes del borrado no recrea datos.
    assert APIClient().get(
        "/api/preferencias-alertas/", HTTP_X_ORGANIZACION_ID=str(org), HTTP_X_USUARIO_ID="42",
    ).status_code == 403
    assert not PreferenciaNotificacion.objects.filter(organizacion_id=org, usuario_id="42").exists()


@pytest.mark.django_db
def test_limpieza_personal_que_llega_despues_de_la_organizacion_no_recrea_datos(monkeypatch):
    """El worker procesa primero las organizaciones: el ACK personal llega tarde."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    operacion_org, operacion_personal = uuid.uuid4(), uuid.uuid4()
    for tenant in (org, otra):
        PreferenciaNotificacion.objects.create(organizacion_id=tenant, usuario_id="42")

    def borrar(ruta, destino, operacion):
        firma = cabeceras_eliminacion(destino, org, operacion)
        return APIClient().delete(
            ruta, {"operacion_id": str(operacion)}, format="json",
            **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
        )

    assert borrar(f"/internal/organizaciones/{org}/", "notifications", operacion_org).status_code == 204
    personal = f"/internal/organizaciones/{org}/usuarios/42/"
    for _ in range(2):
        assert borrar(personal, "notifications:usuario:42", operacion_personal).status_code == 204
    assert not UsuarioEliminado.objects.filter(organizacion_id=org).exists()
    assert not PreferenciaNotificacion.objects.filter(organizacion_id=org).exists()
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    assert PreferenciaNotificacion.objects.filter(organizacion_id=otra, usuario_id="42").exists()

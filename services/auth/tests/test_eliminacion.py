import logging
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import requests

import pytest
from django.core.cache import caches
from django.utils import timezone
from redis.exceptions import ConnectionError
from rest_framework.test import APIClient

from app.eliminacion import SERVICIOS, procesar_eliminacion
from app.models import EliminacionOrganizacion, EliminacionUsuario, Organizacion, User
from app.serializers import RegisterSerializer

pytestmark = pytest.mark.django_db
PASSWORD = "ClaveSegura123"


def usuario(org, correo="titular@test.cl", rol=User.Rol.TITULAR):
    return User.objects.create_user(email=correo, nombre="Prueba", password=PASSWORD, organizacion=org, rol=rol)


def eliminar(user, **body):
    cabeceras = {"HTTP_X_USUARIO_ID": str(user.pk)}
    if user.organizacion_id is not None:
        cabeceras["HTTP_X_ORGANIZACION_ID"] = str(user.organizacion_id)
    return APIClient().delete(
        "/api/usuarios/me/", {"password": PASSWORD, "confirmacion": "ELIMINAR", **body}, format="json",
        **cabeceras,
    )


def test_integrante_elimina_solo_su_cuenta_y_revoca_sesiones():
    org = Organizacion.objects.create(nombre="Compartida")
    titular = usuario(org)
    integrante = usuario(org, "integrante@test.cl", User.Rol.INTEGRANTE)
    caches["sesiones"].set(f"usuario:{integrante.pk}", "sesion")
    assert eliminar(integrante).status_code == 204
    assert not User.objects.filter(pk=integrante.pk).exists()
    assert User.objects.filter(pk=titular.pk).exists()
    assert Organizacion.objects.filter(pk=org.pk).exists()
    assert not EliminacionOrganizacion.objects.exists()
    assert caches["sesiones"].get(f"usuario:{integrante.pk}") is None


def test_titular_con_otro_titular_conserva_organizacion():
    org = Organizacion.objects.create(nombre="Compartida")
    primero = usuario(org)
    segundo = usuario(org, "segundo@test.cl")
    assert eliminar(primero).status_code == 204
    assert User.objects.filter(pk=segundo.pk).exists()
    assert not EliminacionOrganizacion.objects.exists()


def test_cuenta_sin_organizacion_elimina_perfil_y_sesiones_sin_outbox():
    user = usuario(None)
    caches["sesiones"].set(f"usuario:{user.pk}", "sesion")
    assert eliminar(user, password="incorrecta").status_code == 403
    assert User.objects.filter(pk=user.pk).exists()
    assert eliminar(user).status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()
    assert caches["sesiones"].get(f"usuario:{user.pk}") is None
    assert not EliminacionOrganizacion.objects.exists()


def test_cuenta_sin_organizacion_rechaza_cabecera_ajena():
    user = usuario(None)
    org = Organizacion.objects.create(nombre="Ajena")
    respuesta = APIClient().delete(
        "/api/usuarios/me/", {"password": PASSWORD, "confirmacion": "ELIMINAR"}, format="json",
        HTTP_X_USUARIO_ID=str(user.pk), HTTP_X_ORGANIZACION_ID=str(org.pk),
    )
    assert respuesta.status_code == 404
    assert User.objects.filter(pk=user.pk).exists()
    assert Organizacion.objects.filter(pk=org.pk).exists()


def test_cuenta_con_organizacion_no_puede_omitir_contexto_tenant():
    user = usuario(Organizacion.objects.create(nombre="Propia"))
    respuesta = APIClient().delete(
        "/api/usuarios/me/", {"password": PASSWORD, "confirmacion": "ELIMINAR"}, format="json",
        HTTP_X_USUARIO_ID=str(user.pk),
    )
    assert respuesta.status_code == 403
    assert User.objects.filter(pk=user.pk).exists()
    assert not EliminacionOrganizacion.objects.exists()


@pytest.mark.parametrize("body,estado", [
    ({"password": "incorrecta"}, 403), ({"confirmacion": "NO"}, 400), ({}, 409),
])
def test_reautenticacion_y_confirmacion_explicita(body, estado):
    org = Organizacion.objects.create(nombre="Confirmar")
    user = usuario(org)
    assert eliminar(user, **body).status_code == estado
    assert User.objects.filter(pk=user.pk).exists()
    assert not EliminacionOrganizacion.objects.exists()


def test_ultimo_titular_crea_outbox_y_no_toca_otro_tenant():
    org = Organizacion.objects.create(nombre="Borrar")
    user = usuario(org)
    integrante = usuario(org, "integrante@test.cl", User.Rol.INTEGRANTE)
    otra = Organizacion.objects.create(nombre="Conservar")
    ajeno = usuario(otra, "ajeno@test.cl")
    for cuenta in (user, integrante, ajeno):
        caches["sesiones"].set(f"usuario:{cuenta.pk}", "sesion")
    respuesta = eliminar(user, confirmacion_organizacion="ELIMINAR")
    assert respuesta.status_code == 202
    operacion = EliminacionOrganizacion.objects.get(pk=respuesta.data["operacion_id"])
    assert set(operacion.pendientes) == set(SERVICIOS)
    assert not User.objects.filter(organizacion=org).exists()
    assert User.objects.filter(pk=ajeno.pk).exists()
    assert caches["sesiones"].get(f"usuario:{ajeno.pk}") == "sesion"
    assert caches["sesiones"].get(f"usuario:{integrante.pk}") is None
    assert Organizacion.objects.filter(pk=org.pk).exists()  # hasta los cuatro ACK


def test_fallo_redis_revierte_eliminacion():
    org = Organizacion.objects.create(nombre="Reintentar")
    user = usuario(org)
    with patch("app.eliminacion.caches") as caches_mock:
        caches_mock.__getitem__.return_value.delete.side_effect = ConnectionError()
        assert eliminar(user, confirmacion_organizacion="ELIMINAR").status_code == 503
    assert User.objects.filter(pk=user.pk).exists()
    assert not EliminacionOrganizacion.objects.exists()


def test_contexto_ajeno_no_borra_usuario():
    org = Organizacion.objects.create(nombre="Propia")
    user = usuario(org)
    otra = Organizacion.objects.create(nombre="Ajena")
    respuesta = APIClient().delete(
        "/api/usuarios/me/", {"password": PASSWORD, "confirmacion": "ELIMINAR"}, format="json",
        HTTP_X_USUARIO_ID=str(user.pk), HTTP_X_ORGANIZACION_ID=str(otra.pk),
    )
    assert respuesta.status_code == 404
    assert User.objects.filter(pk=user.pk).exists()


def test_outbox_reintenta_solo_sin_ack_y_finaliza_despues(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = Organizacion.objects.create(nombre="Pendiente")
    operacion = EliminacionOrganizacion.objects.create(organizacion_id=org.pk, pendientes=list(SERVICIOS))
    with patch("app.eliminacion.requests.delete", side_effect=[
        SimpleNamespace(status_code=204), SimpleNamespace(status_code=409),
        SimpleNamespace(status_code=204), SimpleNamespace(status_code=204),
    ]) as enviar:
        assert not procesar_eliminacion(operacion.pk)
        assert all(llamada.kwargs["timeout"] == (2, 5) for llamada in enviar.call_args_list)
    operacion.refresh_from_db()
    assert operacion.pendientes == ["connectors"]
    assert Organizacion.objects.filter(pk=org.pk).exists()
    with patch("app.eliminacion.requests.delete", return_value=SimpleNamespace(status_code=204)) as enviar:
        assert procesar_eliminacion(operacion.pk)
        assert enviar.call_count == 1
        assert str(org.pk) in enviar.call_args.args[0]
    assert not Organizacion.objects.filter(pk=org.pk).exists()
    operacion.refresh_from_db()
    assert operacion.completado_en is not None
    with patch("app.eliminacion.requests.delete") as enviar:
        assert procesar_eliminacion(operacion.pk)
        enviar.assert_not_called()


def test_registro_no_puede_unirse_a_org_en_eliminacion():
    org = Organizacion.objects.create(nombre="Pendiente")
    EliminacionOrganizacion.objects.create(organizacion_id=org.pk, pendientes=list(SERVICIOS))
    serializer = RegisterSerializer(data={
        "email": "nuevo@test.cl", "nombre": "Nuevo", "password": PASSWORD,
        "acepta_datos": True, "codigo_organizacion": str(org.pk),
    })
    assert serializer.is_valid(), serializer.errors
    from rest_framework.exceptions import ValidationError
    with pytest.raises(ValidationError):
        serializer.save()
    assert not User.objects.exists()


def test_caida_de_servicio_conserva_outbox(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = Organizacion.objects.create(nombre="Reintentar")
    operacion = EliminacionOrganizacion.objects.create(organizacion_id=org.pk, pendientes=["subscriptions"])
    with patch("app.eliminacion.requests.delete", side_effect=requests.Timeout()):
        assert not procesar_eliminacion(operacion.pk)
    operacion.refresh_from_db()
    assert operacion.pendientes == ["subscriptions"]
    assert operacion.completado_en is None
    assert Organizacion.objects.filter(pk=org.pk).exists()


@pytest.mark.django_db(transaction=True)
def test_dos_titulares_concurrentes_crean_una_sola_eliminacion():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("select_for_update requiere PostgreSQL")
    org = Organizacion.objects.create(nombre="Concurrente")
    cuentas = [usuario(org), usuario(org, "segundo@test.cl")]
    barrera = Barrier(2)

    def peticion(cuenta):
        close_old_connections()
        try:
            barrera.wait(timeout=10)
            return eliminar(cuenta, confirmacion_organizacion="ELIMINAR").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        estados = list(pool.map(peticion, cuentas))
    assert sorted(estados) == [202, 204]
    assert EliminacionOrganizacion.objects.filter(organizacion_id=org.pk).count() == 1
    assert not User.objects.filter(organizacion=org).exists()


def test_integrante_deja_limpieza_personal_durable_y_worker_reintenta(monkeypatch):
    from app.models import EliminacionUsuario
    from shared.eliminacion import cabeceras_eliminacion
    from django.core.management import call_command
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = Organizacion.objects.create(nombre="Compartida")
    titular = usuario(org)
    integrante = usuario(org, "integrante@test.cl", User.Rol.INTEGRANTE)
    pk = integrante.pk
    assert eliminar(integrante).status_code == 204
    operacion = EliminacionUsuario.objects.get(usuario_id=pk, organizacion_id=org.pk)
    assert operacion.pendientes == ["notifications"]
    with patch("app.eliminacion.requests.delete", side_effect=requests.Timeout()):
        call_command("procesar_eliminaciones")
    operacion.refresh_from_db()
    assert operacion.pendientes == ["notifications"] and operacion.completado_en is None
    with patch("app.eliminacion.requests.delete", return_value=SimpleNamespace(status_code=204)) as enviar:
        call_command("procesar_eliminaciones")
        llamada = enviar.call_args
        assert llamada.args[0].endswith(f"/internal/organizaciones/{org.pk}/usuarios/{pk}/")
        firma = cabeceras_eliminacion(f"notifications:usuario:{pk}", org.pk, operacion.pk)
        assert llamada.kwargs["headers"]["X-Eliminacion-Firma"] == firma["X-Eliminacion-Firma"]
    operacion.refresh_from_db()
    assert operacion.completado_en is not None and operacion.pendientes == []
    assert Organizacion.objects.filter(pk=org.pk).exists()
    assert User.objects.filter(pk=titular.pk).exists()
    with patch("app.eliminacion.requests.delete") as enviar:
        call_command("procesar_eliminaciones")
        enviar.assert_not_called()


def test_destinos_se_guardan_al_crear_y_no_se_recortan_en_reintento(monkeypatch):
    monkeypatch.setenv("ELIMINACION_DESTINOS", "subscriptions, notifications")
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = Organizacion.objects.create(nombre="Demo")
    respuesta = eliminar(usuario(org), confirmacion_organizacion="ELIMINAR")
    operacion = EliminacionOrganizacion.objects.get(pk=respuesta.data["operacion_id"])
    assert operacion.pendientes == ["subscriptions", "notifications"]
    monkeypatch.setenv("ELIMINACION_DESTINOS", "subscriptions")
    with patch("app.eliminacion.requests.delete", return_value=SimpleNamespace(status_code=503)) as enviar:
        assert not procesar_eliminacion(operacion.pk)
    assert enviar.call_count == 2
    operacion.refresh_from_db()
    assert operacion.pendientes == ["subscriptions", "notifications"]


@pytest.mark.parametrize("valor", ["", "subcriptions", "subscriptions,subscriptions"])
def test_destinos_invalidos_no_eliminan_usuario(monkeypatch, valor):
    monkeypatch.setenv("ELIMINACION_DESTINOS", valor)
    org = Organizacion.objects.create(nombre="Conservar")
    user = usuario(org)
    respuesta = eliminar(user, confirmacion_organizacion="ELIMINAR")
    assert respuesta.status_code == 503
    assert respuesta.data["code"] == "eliminacion_no_configurada"
    assert User.objects.filter(pk=user.pk).exists()
    assert not EliminacionOrganizacion.objects.exists()


@pytest.mark.parametrize("rol,cuerpo", [
    (User.Rol.TITULAR, {"confirmacion_organizacion": "ELIMINAR"}),  # último titular: sería 202
    (User.Rol.INTEGRANTE, {}),  # limpieza personal: sería 204
])
def test_sin_secreto_interno_no_elimina_ni_revoca_sesiones(monkeypatch, rol, cuerpo):
    """Con el .env.example tal como viene, ninguna limpieza se podría firmar."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "")
    org = Organizacion.objects.create(nombre="Conservar")
    titular = usuario(org)
    integrante = usuario(org, "integrante@test.cl", User.Rol.INTEGRANTE)
    cuenta = titular if rol == User.Rol.TITULAR else integrante
    caches["sesiones"].set(f"usuario:{cuenta.pk}", "sesion")
    respuesta = eliminar(cuenta, **cuerpo)
    assert respuesta.status_code == 503
    assert respuesta.data["code"] == "eliminacion_no_configurada"
    assert User.objects.filter(pk__in=[titular.pk, integrante.pk]).count() == 2
    assert caches["sesiones"].get(f"usuario:{cuenta.pk}") == "sesion"
    assert not EliminacionOrganizacion.objects.exists()
    assert not EliminacionUsuario.objects.exists()


def test_worker_sin_secreto_conserva_pendiente_y_registra_la_causa(monkeypatch, caplog):
    org = Organizacion.objects.create(nombre="Pendiente")
    operacion = EliminacionOrganizacion.objects.create(organizacion_id=org.pk, pendientes=list(SERVICIOS))
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "")
    caplog.set_level(logging.WARNING, logger="app.eliminacion")
    with patch("app.eliminacion.requests.delete") as enviar:
        assert not procesar_eliminacion(operacion.pk)
        enviar.assert_not_called()
    operacion.refresh_from_db()
    assert operacion.pendientes == list(SERVICIOS)
    assert operacion.completado_en is None
    assert Organizacion.objects.filter(pk=org.pk).exists()
    assert "ELIMINACION_INTERNA_SECRET no configurado" in caplog.text
    assert str(operacion.pk) in caplog.text


def test_worker_registra_por_que_un_destino_sigue_pendiente(caplog):
    org = Organizacion.objects.create(nombre="Pendiente")
    operacion = EliminacionOrganizacion.objects.create(
        organizacion_id=org.pk, pendientes=["subscriptions", "connectors"],
    )
    caplog.set_level(logging.WARNING, logger="app.eliminacion")
    with patch("app.eliminacion.requests.delete", side_effect=[
        requests.ConnectTimeout(), SimpleNamespace(status_code=409),
    ]):
        assert not procesar_eliminacion(operacion.pk)
    assert "subscriptions: sin respuesta (ConnectTimeout)" in caplog.text
    assert "connectors: respondió 409" in caplog.text


@pytest.mark.parametrize("por_usuario", [False, True])
def test_reprocesar_operacion_completada_no_reescribe_completado_en(por_usuario):
    """`completado_en` es la fecha que se mide contra las 72 h."""
    terminada = timezone.now() - timedelta(days=1)
    org = uuid.uuid4()
    if por_usuario:
        operacion = EliminacionUsuario.objects.create(
            organizacion_id=org, usuario_id=42, pendientes=[], completado_en=terminada,
        )
    else:
        operacion = EliminacionOrganizacion.objects.create(
            organizacion_id=org, pendientes=[], completado_en=terminada,
        )
    with patch("app.eliminacion.requests.delete") as enviar:
        assert procesar_eliminacion(operacion.pk, por_usuario=por_usuario)
        enviar.assert_not_called()
    operacion.refresh_from_db()
    assert operacion.completado_en == terminada

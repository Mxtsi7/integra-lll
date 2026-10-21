import json
import uuid
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from app.models import Cobro, Proveedor, RegistroUso, Subscription
from shared.eliminacion import cabeceras_eliminacion
from shared.borrado.models import EstadoOrganizacion

pytestmark = pytest.mark.django_db


def llamada(org, operacion, **cabeceras):
    return APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in cabeceras.items()},
    )


def suscripcion(org, proveedor):
    return Subscription.objects.create(
        organizacion_id=org, proveedor=proveedor, nombre="Prueba", monto=1000,
        frecuencia="mensual", fecha_proximo_cobro="2026-11-01",
    )


def test_limpieza_idempotente_conserva_otros_tenants_y_catalogo(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    proveedor = Proveedor.objects.create(nombre="Proveedor global")
    propia, ajena = suscripcion(org, proveedor), suscripcion(otra, proveedor)
    for sub in (propia, ajena):
        Cobro.objects.create(organizacion_id=sub.organizacion_id, suscripcion=sub, monto=1000, fecha="2026-10-01")
        RegistroUso.objects.create(organizacion_id=sub.organizacion_id, suscripcion=sub, minutos=5, fecha="2026-10-01")
    for _ in range(2):
        assert llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 204
    assert not Subscription.objects.filter(organizacion_id=org).exists()
    assert Subscription.objects.filter(pk=ajena.pk).exists()
    assert Cobro.objects.filter(organizacion_id=otra).count() == 1
    assert RegistroUso.objects.filter(organizacion_id=otra).count() == 1
    assert Proveedor.objects.filter(pk=proveedor.pk).exists()
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    respuesta = APIClient().post(
        "/api/suscripciones/", {"nombre": "Resucitar", "monto": 1000, "frecuencia": "mensual",
                                "fecha_proximo_cobro": "2026-11-01"}, format="json",
        HTTP_X_ORGANIZACION_ID=str(org),
    )
    assert respuesta.status_code == 410
    assert not Subscription.objects.filter(organizacion_id=org).exists()
    from rest_framework.exceptions import PermissionDenied
    from shared.borrado.bloqueo import escritura_organizacion
    with pytest.raises(PermissionDenied), escritura_organizacion(org):
        suscripcion(org, proveedor)


def test_cascade_local_inconsistente_no_borra_datos_ajenos(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    propia = suscripcion(org, Proveedor.objects.create(nombre="Proveedor"))
    cobro = Cobro.objects.create(organizacion_id=otra, suscripcion=propia, monto=1000, fecha="2026-10-01")
    assert llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 409
    assert Cobro.objects.filter(pk=cobro.pk).exists()
    assert Subscription.objects.filter(pk=propia.pk).exists()


def test_firma_rechaza_cambio_tenant_destino_y_caducidad(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, operacion = uuid.uuid4(), uuid.uuid4()
    assert llamada(org, operacion).status_code == 403
    assert llamada(uuid.uuid4(), operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 403
    assert llamada(org, operacion, **cabeceras_eliminacion("connectors", org, operacion)).status_code == 403
    with patch("shared.eliminacion.time.time", return_value=100):
        firma = cabeceras_eliminacion("subscriptions", org, operacion)
    assert llamada(org, operacion, **firma).status_code == 403
    assert not EstadoOrganizacion.objects.exists()


@pytest.mark.parametrize("cuerpo", [[], ["operacion_id"], "texto", None, 1, True])
def test_cuerpo_json_sin_objeto_se_rechaza_sin_cambios(cuerpo, monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org = uuid.uuid4()
    propia = suscripcion(org, Proveedor.objects.create(nombre="Proveedor"))
    respuesta = APIClient().generic(
        "DELETE", f"/internal/organizaciones/{org}/",
        data=json.dumps(cuerpo), content_type="application/json",
    )
    assert respuesta.status_code == 403
    assert Subscription.objects.filter(pk=propia.pk).exists()
    assert not EstadoOrganizacion.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_limpieza_espera_escritura_en_vuelo_y_luego_borra(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    from threading import Event
    from django.db import close_old_connections, connection
    from django.db.models.signals import post_save

    if connection.vendor != "postgresql":
        pytest.skip("El bloqueo de filas requiere PostgreSQL")
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, operacion = uuid.uuid4(), uuid.uuid4()
    escribiendo, continuar = Event(), Event()

    def pausar_escritura(sender, instance, **kwargs):
        if str(instance.organizacion_id) == str(org):
            escribiendo.set()
            assert continuar.wait(timeout=10)

    def escribir():
        close_old_connections()
        try:
            return APIClient().post(
                "/api/suscripciones/", {"nombre": "En vuelo", "monto": 1000, "frecuencia": "mensual",
                                        "fecha_proximo_cobro": "2026-11-01"}, format="json",
                HTTP_X_ORGANIZACION_ID=str(org),
            ).status_code
        finally:
            close_old_connections()

    def limpiar():
        close_old_connections()
        try:
            return llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code
        finally:
            close_old_connections()

    post_save.connect(pausar_escritura, sender=Subscription, weak=False)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            escritura = pool.submit(escribir)
            assert escribiendo.wait(timeout=10)
            limpieza = pool.submit(limpiar)
            try:
                with pytest.raises(TimeoutError):
                    limpieza.result(timeout=0.2)
            finally:
                continuar.set()
            assert escritura.result(timeout=10) == 201
            assert limpieza.result(timeout=10) == 204
    finally:
        continuar.set()
        post_save.disconnect(pausar_escritura, sender=Subscription)
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
    assert not Subscription.objects.filter(organizacion_id=org).exists()

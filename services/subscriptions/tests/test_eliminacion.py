import json
import uuid
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from app.models import (
    Cobro, Proveedor, RegistroUso, ResumenOrganizacion, Subscription,
    TrabajoDerivado, TransicionEstado,
)
from app.models import OutboxEvento, Presupuesto
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
    assert not EstadoOrganizacion.objects.filter(organizacion_id=org, eliminada=True).exists()
    # Corregir la inconsistencia permite reintentar la misma operación.
    cobro.organizacion_id = org
    cobro.save(update_fields=["organizacion_id"])
    assert llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 204
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada


def test_limpieza_borra_outbox_y_presupuestos_solo_del_tenant(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    for tenant in (org, otra):
        Presupuesto.objects.create(organizacion_id=tenant, mes="2026-10", moneda="CLP", monto=1000)
        OutboxEvento.objects.create(
            organizacion_id=tenant, evento="suscripcion.creada",
            correlation_id=uuid.uuid4(), datos={"nombre": "Dato privado"},
        )
    for _ in range(2):
        assert llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 204
    for modelo in (Presupuesto, OutboxEvento):
        assert not modelo.objects.filter(organizacion_id=org).exists()
        assert modelo.objects.filter(organizacion_id=otra).count() == 1


def test_limpieza_borra_resumen_y_trabajo_derivado_solo_del_tenant_con_doble_entrega(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    evento_org, evento_otra = uuid.uuid4(), uuid.uuid4()
    for tenant, evento in ((org, evento_org), (otra, evento_otra)):
        ResumenOrganizacion.objects.create(
            organizacion_id=tenant, moneda="CLP", total_mensual=1000, cantidad_activas=1,
        )
        TrabajoDerivado.objects.create(
            organizacion_id=tenant, evento_id=evento, hecho_por="consumidor",
        )

    for _ in range(2):
        assert llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 204

    for modelo in (ResumenOrganizacion, TrabajoDerivado):
        assert not modelo.objects.filter(organizacion_id=org).exists()
        assert modelo.objects.filter(organizacion_id=otra).count() == 1


def transicion(org, sub):
    return TransicionEstado.objects.create(
        organizacion_id=org, suscripcion=sub,
        evento=Subscription.EventoEstado.CANCELACION_USUARIO,
        estado_anterior=Subscription.Estado.ACTIVO, estado_nuevo=Subscription.Estado.CANCELADO,
    )


def test_historial_tenant_inconsistente_no_se_borra_por_cascada(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    propia = suscripcion(org, Proveedor.objects.create(nombre="Proveedor"))
    ajeno = transicion(otra, propia)
    assert llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 409
    assert TransicionEstado.objects.filter(pk=ajeno.pk).exists()
    assert Subscription.objects.filter(pk=propia.pk).exists()


def test_historial_propio_se_elimina_aunque_apunte_a_suscripcion_ajena(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    ajena = suscripcion(otra, Proveedor.objects.create(nombre="Proveedor"))
    propio, ajeno = transicion(org, ajena), transicion(otra, ajena)
    assert llamada(org, operacion, **cabeceras_eliminacion("subscriptions", org, operacion)).status_code == 204
    assert not TransicionEstado.objects.filter(pk=propio.pk).exists()
    assert TransicionEstado.objects.filter(pk=ajeno.pk).exists()
    assert Subscription.objects.filter(pk=ajena.pk).exists()


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


@pytest.mark.django_db(transaction=True)
def test_escrituras_del_mismo_tenant_avanzan_en_paralelo():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections, connection
    from shared.borrado.bloqueo import escritura_organizacion
    if connection.vendor != "postgresql":
        pytest.skip("FOR SHARE requiere PostgreSQL")
    org = uuid.uuid4()
    EstadoOrganizacion.objects.create(organizacion_id=org)
    dentro = Barrier(2)
    def escribir():
        close_old_connections()
        try:
            with escritura_organizacion(org):
                dentro.wait(timeout=5)
                return Subscription.objects.create(
                    organizacion_id=org, nombre="Concurrente", monto=1000,
                    frecuencia="mensual", fecha_proximo_cobro="2026-11-01",
                ).pk
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(lambda _: escribir(), range(2)))
    assert len(set(ids)) == 2

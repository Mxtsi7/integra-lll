"""La proyección de FE-17/18 frente al borrado de la organización (MX-07).

Son las regresiones de un hallazgo que la revisión encontró al integrar esta
rama con #72, y que acá se reproducían las dos:

  1. la limpieza confirmaba un 204 y `SuscripcionVigilada` quedaba en pie,
     con nombre del servicio, monto y fecha de cobro;
  2. un evento reentregado —RabbitMQ entrega al menos una vez— volvía a
     escribir la fila en una organización ya eliminada, y el generador creaba
     alertas desde esa fila resucitada.

Las pruebas de intercalado representan el cruce marcando `eliminada` en el
estado sin borrar las filas: es lo que ve un generador que leyó la proyección
antes de que la limpieza confirmara. Con una sola conexión SQLite no se puede
hacer esperar un `FOR UPDATE`, así que lo que se comprueba acá es la decisión,
no el bloqueo del motor.
"""

import datetime as dt
import uuid

import pytest
from django.utils import timezone

from rest_framework.test import APIClient

from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion
from shared.tenant.base import ModeloTenant

from notifications import generador, proyeccion
from notifications.eliminacion import LimpiezaNotificationsView
from notifications.models import (
    Alerta,
    PreferenciaNotificacion,
    SuscripcionVigilada,
)


SECRETO = "secreto-solo-prueba"


def limpiar(organizacion_id):
    """La limpieza de verdad: firmada, por HTTP, como la llama auth."""
    operacion = uuid.uuid4()
    firma = cabeceras_eliminacion("notifications", organizacion_id, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{organizacion_id}/",
        {"operacion_id": str(operacion)},
        format="json",
        **{f"HTTP_{k.upper().replace('-', '_')}": v for k, v in firma.items()},
    )


def sobre(organizacion_id, suscripcion_id, *, estado="activo", proximo_cobro="2026-11-15"):
    """Un `suscripcion.creada` del catálogo MX-21 v2, completo."""
    return {
        "evento": "suscripcion.creada",
        "version": 2,
        "id": str(uuid.uuid4()),
        "correlation_id": str(uuid.uuid4()),
        "organizacion_id": str(organizacion_id),
        "ocurrido_en": "2026-10-30T12:00:00Z",
        "datos": {
            "suscripcion_id": str(suscripcion_id),
            "nombre": "Netflix Premium",
            "monto": "12990.00",
            "moneda": "CLP",
            "ciclo": "mensual",
            "proximo_cobro": proximo_cobro,
            "estado": estado,
        },
    }


def marcar_eliminada(organizacion_id):
    """Lo que deja la limpieza, sin borrar las filas: así se representa el
    generador que leyó la proyección ANTES de que el 204 se confirmara."""
    estado, _ = EstadoOrganizacion.objects.get_or_create(organizacion_id=organizacion_id)
    estado.eliminada = True
    estado.save(update_fields=["eliminada"])


# ── 1. La limpieza se lleva la proyección ───────────────────────────────────

@pytest.mark.django_db
def test_la_limpieza_borra_la_proyeccion_y_deja_intacta_la_otra_organizacion(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
    org, otra = uuid.uuid4(), uuid.uuid4()
    for tenant in (org, otra):
        assert proyeccion.aplicar(sobre(tenant, uuid.uuid4())) is True
        PreferenciaNotificacion.objects.create(organizacion_id=tenant, usuario_id="42")
        Alerta.objects.create(
            organizacion_id=tenant, tipo=Alerta.Tipo.PROXIMO_COBRO,
            titulo="Cobro", mensaje="Aviso", evento_id=uuid.uuid4(),
        )

    assert limpiar(org).status_code == 204
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada

    assert not SuscripcionVigilada.objects.filter(organizacion_id=org).exists()
    assert not Alerta.objects.filter(organizacion_id=org).exists()
    assert not PreferenciaNotificacion.objects.filter(organizacion_id=org).exists()

    assert SuscripcionVigilada.objects.filter(organizacion_id=otra).count() == 1
    assert Alerta.objects.filter(organizacion_id=otra).count() == 1
    assert PreferenciaNotificacion.objects.filter(organizacion_id=otra).count() == 1


@pytest.mark.django_db
def test_la_limpieza_es_idempotente_con_la_proyeccion(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
    org = uuid.uuid4()
    assert proyeccion.aplicar(sobre(org, uuid.uuid4())) is True
    for _ in range(2):
        assert limpiar(org).status_code == 204
    assert not SuscripcionVigilada.objects.filter(organizacion_id=org).exists()


def test_la_limpieza_declara_todos_los_modelos_de_tenant():
    """Si mañana aparece otro `ModeloTenant` en notifications, esta prueba
    falla hasta que entre en la limpieza. Es justo lo que no había cuando se
    agregó `SuscripcionVigilada` y quedó fuera."""
    concretos = {
        m for m in ModeloTenant.__subclasses__()
        if not m._meta.abstract and m._meta.app_label == "notifications"
    }
    assert concretos, "no encontré los modelos de tenant de notifications"
    assert set(LimpiezaNotificationsView.modelos) == concretos


# ── 2. Un evento que llega después no resucita nada ─────────────────────────

@pytest.mark.django_db
def test_un_evento_reentregado_no_resucita_una_organizacion_eliminada(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
    org, suscripcion = uuid.uuid4(), uuid.uuid4()
    assert limpiar(org).status_code == 204

    # Ni `SobreInvalido` ni excepción: el sobre está bien, lo que no existe es
    # el destinatario. False es lo que hace que el consumidor confirme y
    # descarte, en vez de dejarlo girando en la cola de fallidos.
    assert proyeccion.aplicar(sobre(org, suscripcion)) is False
    assert not SuscripcionVigilada.objects.filter(organizacion_id=org).exists()


@pytest.mark.django_db
def test_un_evento_de_otra_organizacion_sigue_entrando(monkeypatch):
    """La guarda es por tenant, no un apagado general."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
    borrada, viva = uuid.uuid4(), uuid.uuid4()
    assert limpiar(borrada).status_code == 204
    assert proyeccion.aplicar(sobre(viva, uuid.uuid4())) is True
    assert SuscripcionVigilada.objects.filter(organizacion_id=viva).count() == 1


@pytest.mark.django_db
def test_una_actualizacion_posterior_no_recrea_la_fila_borrada(monkeypatch):
    """No solo `creada`: los tres eventos traen el snapshot completo y los
    tres pasan por `get_or_create`."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
    org, suscripcion = uuid.uuid4(), uuid.uuid4()
    assert proyeccion.aplicar(sobre(org, suscripcion)) is True
    assert limpiar(org).status_code == 204

    for evento in ("suscripcion.actualizada", "suscripcion.estado_cambiado"):
        tardio = sobre(org, suscripcion)
        tardio["evento"] = evento
        tardio["ocurrido_en"] = "2026-10-31T12:00:00Z"
        assert proyeccion.aplicar(tardio) is False
    assert not SuscripcionVigilada.objects.filter(organizacion_id=org).exists()


# ── 3. Intercalado con la generación ────────────────────────────────────────

@pytest.mark.django_db
def test_el_generador_no_crea_alertas_para_una_organizacion_eliminada():
    """El cruce: el generador ya leyó la proyección y la limpieza confirmó
    antes de que llegara a crear la alerta."""
    org, suscripcion = uuid.uuid4(), uuid.uuid4()
    ahora = timezone.now()
    SuscripcionVigilada.objects.create(
        organizacion_id=org, suscripcion_id=suscripcion, nombre="Netflix Premium",
        monto="12990.00", moneda="CLP", ciclo="mensual", estado="activo",
        proximo_cobro=timezone.localdate(ahora) + dt.timedelta(days=1),
        observada_en=ahora,
    )
    marcar_eliminada(org)

    resultado = generador.generar(ahora=ahora)

    assert resultado.creadas == []
    assert resultado.omitidas == 1
    assert resultado.repetidas == 0
    assert not Alerta.objects.filter(organizacion_id=org).exists()


@pytest.mark.django_db
def test_el_generador_no_avisa_un_fin_de_prueba_de_una_organizacion_eliminada():
    org, suscripcion = uuid.uuid4(), uuid.uuid4()
    ahora = timezone.now()
    SuscripcionVigilada.objects.create(
        organizacion_id=org, suscripcion_id=suscripcion, nombre="Spotify",
        monto="5990.00", moneda="CLP", ciclo="mensual", estado="prueba",
        proximo_cobro=timezone.localdate(ahora) + dt.timedelta(days=30),
        fin_prueba=timezone.localdate(ahora) + dt.timedelta(days=1),
        observada_en=ahora,
    )
    marcar_eliminada(org)

    resultado = generador.generar(ahora=ahora)

    assert resultado.creadas == []
    assert resultado.omitidas == 1
    assert not Alerta.objects.filter(organizacion_id=org).exists()


@pytest.mark.django_db
def test_el_generador_sigue_avisando_a_las_organizaciones_vivas():
    """La guarda no puede apagar la generación: una eliminada y una viva en la
    misma corrida dejan exactamente una alerta."""
    borrada, viva = uuid.uuid4(), uuid.uuid4()
    ahora = timezone.now()
    for tenant in (borrada, viva):
        SuscripcionVigilada.objects.create(
            organizacion_id=tenant, suscripcion_id=uuid.uuid4(), nombre="Netflix Premium",
            monto="12990.00", moneda="CLP", ciclo="mensual", estado="activo",
            proximo_cobro=timezone.localdate(ahora) + dt.timedelta(days=1),
            observada_en=ahora,
        )
    marcar_eliminada(borrada)

    resultado = generador.generar(ahora=ahora)

    assert len(resultado.creadas) == 1
    assert resultado.creadas[0].organizacion_id == viva
    assert resultado.omitidas == 1
    assert Alerta.objects.filter(organizacion_id=borrada).count() == 0
    assert Alerta.objects.filter(organizacion_id=viva).count() == 1


@pytest.mark.django_db
def test_la_ingesta_y_la_generacion_posteriores_a_la_limpieza_no_dejan_filas(monkeypatch):
    """El circuito completo de la aceptación: organización con proyección y
    alertas, limpieza real, y después evento reentregado MÁS una corrida del
    generador. No tiene que quedar nada."""
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
    org, suscripcion = uuid.uuid4(), uuid.uuid4()
    ahora = timezone.now()
    manana = (timezone.localdate(ahora) + dt.timedelta(days=1)).isoformat()

    assert proyeccion.aplicar(sobre(org, suscripcion, proximo_cobro=manana)) is True
    assert len(generador.generar(ahora=ahora).creadas) == 1

    assert limpiar(org).status_code == 204
    assert not SuscripcionVigilada.objects.filter(organizacion_id=org).exists()
    assert not Alerta.objects.filter(organizacion_id=org).exists()

    assert proyeccion.aplicar(sobre(org, suscripcion, proximo_cobro=manana)) is False
    resultado = generador.generar(ahora=ahora)

    assert resultado.creadas == []
    assert resultado.revisadas == 0, "la proyección volvió a existir"
    assert not SuscripcionVigilada.objects.filter(organizacion_id=org).exists()
    assert not Alerta.objects.filter(organizacion_id=org).exists()

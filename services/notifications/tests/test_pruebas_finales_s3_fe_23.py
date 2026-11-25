"""S3-FE-23 — pruebas finales de punta a punta del lado de notifications.

Caso 6 del doc 34: una cancelación o un cambio de fecha que llega ANTES del
envío no deja salir el aviso viejo. Se recorre el camino completo con los
módulos REALES:

    evento (MX-21 v2) ─▶ proyeccion.aplicar ─▶ generador ─▶ entregas.planificar
                                   │                                  │
                                   └─▶ invalidacion.revisar           ▼
                                                        entregas.despachar ─▶ correo

Qué es un doble y qué es real:
- DOBLE: el proveedor de correo es el buzón en memoria de Django (`locmem`).
  No sale ningún correo real.
- REAL: todo lo demás, incluido el despacho completo (reclamo, canal de correo
  y anotación de la entrega) y la API de la campana.

La carrera entre el generador y una cancelación, con dos conexiones a
PostgreSQL, está en `test_carrera_generador_postgres.py`.
"""

import datetime as dt

import pytest
from django.core import mail
from rest_framework.test import APIClient

from notifications import entregas
from notifications.generador import generar
from notifications.models import Alerta, DireccionCorreo, EntregaAlerta, PreferenciaNotificacion
from notifications.proyeccion import aplicar
from tests.test_invalidacion_s3_fe_22 import COBRO, HOY, ORG, sobre

pytestmark = pytest.mark.django_db

UNA_HORA_DESPUES = HOY + dt.timedelta(hours=1)
CABECERAS = {"X-Organizacion-Id": ORG, "X-Usuario-Id": "42"}


@pytest.fixture(autouse=True)
def buzon(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.DEFAULT_FROM_EMAIL = "no-responder@ejemplo.cl"
    mail.outbox = []
    return mail.outbox


@pytest.fixture(autouse=True)
def persona():
    PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="42")
    DireccionCorreo.objects.create(organizacion_id=ORG, usuario_id="42", email="ana@ejemplo.cl")


def con_aviso_planificado():
    aplicar(sobre("suscripcion.creada", ocurrido="2026-11-01T12:00:00Z"))
    generar(ahora=HOY)
    (alerta,) = Alerta.objects.all()
    assert EntregaAlerta.objects.get(alerta=alerta, canal="email").estado == "pendiente"
    return alerta


class TestCaso6CancelacionAntesDelEnvio:
    def test_control_sin_cambios_el_aviso_sale(self, buzon):
        """El control positivo: sin esto, los casos de abajo pasarían aunque
        el despacho no mandara nada nunca."""
        alerta = con_aviso_planificado()

        entregas.despachar(ahora=UNA_HORA_DESPUES)

        (enviado,) = buzon
        assert enviado.to == ["ana@ejemplo.cl"]
        assert "23-11-2026" in enviado.body
        assert EntregaAlerta.objects.get(alerta=alerta, canal="email").estado == "aceptada"

    def test_cancelar_antes_del_envio_no_deja_salir_el_aviso(self, buzon):
        alerta = con_aviso_planificado()
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado"))

        entregas.despachar(ahora=UNA_HORA_DESPUES)

        assert buzon == []
        entrega = EntregaAlerta.objects.get(alerta=alerta, canal="email")
        assert (entrega.estado, entrega.motivo) == ("descartada", "alerta_obsoleta")
        assert APIClient().get("/api/alertas/contador/", headers=CABECERAS).data["pendientes"] == 0
        # La siguiente corrida del generador no lo recrea.
        generar(ahora=UNA_HORA_DESPUES)
        assert Alerta.objects.count() == 1

    def test_cambiar_la_fecha_antes_del_envio_manda_solo_la_nueva(self, buzon):
        vieja = con_aviso_planificado()
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro="2026-11-22"))
        generar(ahora=UNA_HORA_DESPUES)

        entregas.despachar(ahora=UNA_HORA_DESPUES)

        (enviado,) = buzon
        assert "22-11-2026" in enviado.body and COBRO not in enviado.body
        assert EntregaAlerta.objects.get(alerta=vieja, canal="email").estado == "descartada"
        (nueva,) = Alerta.objects.filter(invalidada_en__isnull=True)
        assert nueva.datos["fecha_cobro"] == "2026-11-22"

    def test_un_evento_repetido_de_la_cancelacion_no_cambia_nada(self, buzon):
        con_aviso_planificado()
        cancelacion = sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado")
        assert aplicar(cancelacion)
        assert not aplicar(cancelacion)

        generar(ahora=UNA_HORA_DESPUES)
        entregas.despachar(ahora=UNA_HORA_DESPUES)

        assert buzon == []
        assert Alerta.objects.count() == 1

"""
S3-FE-22, revisión de #215 — el generador contra un cambio de la suscripción,
con dos conexiones a PostgreSQL de verdad.

`test_invalidacion_s3_fe_22.py::TestCarreraConElGenerador` prueba la decisión
con una conexión. Lo que no puede probar es el orden de bloqueos entre
`generador._crear_una_vez` y `proyeccion.aplicar`. Esto es eso.

── Las dos intercalaciones ────────────────────────────────────────────────
1. La corrida LEYÓ la suscripción y todavía no la bloquea. Entra una
   cancelación y termina. La corrida la relee bloqueada, ve que cambió y no
   crea el aviso.
2. La corrida ya bloqueó la suscripción y creó el aviso. La cancelación
   espera (se mira en `pg_locks`). Cuando la corrida confirma, `aplicar`
   sigue, su `revisar` encuentra el aviso y lo invalida.

En ninguna queda un aviso vigente de una suscripción cancelada.

Mismo método que `test_carrera_entregas_postgres.py`: un hilo A frenado en
un punto, sin `sleep` que decida nada.
"""

import pytest
from django.db import connection

from notifications import entregas, generador
from notifications.generador import generar
from notifications.models import Alerta, DireccionCorreo, EntregaAlerta, PreferenciaNotificacion
from notifications.proyeccion import aplicar
from tests.test_carrera_entregas_postgres import ESPERA, Freno, Hilo, hasta_que_espere, terminar
from tests.test_invalidacion_s3_fe_22 import HOY, ORG, sobre

pytestmark = pytest.mark.django_db(transaction=True)

CANCELACION = dict(evento="suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado")


@pytest.fixture(autouse=True)
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


@pytest.fixture(autouse=True)
def suscripcion(settings):
    settings.DEFAULT_FROM_EMAIL = "no-responder@ejemplo.cl"
    PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="42")
    DireccionCorreo.objects.create(organizacion_id=ORG, usuario_id="42", email="ana@ejemplo.cl")
    aplicar(sobre("suscripcion.creada", ocurrido="2026-11-01T12:00:00Z"))


def cancelar():
    datos = dict(CANCELACION)
    return aplicar(sobre(datos.pop("evento"), **datos))


def test_cancelada_despues_de_leer_y_antes_de_bloquear_no_nace_el_aviso(monkeypatch):
    freno = Freno()
    # A se frena con la organización tomada (FOR SHARE) y la suscripción ya
    # leída, pero todavía sin bloquearla.
    monkeypatch.setattr(generador, "bloquear_organizacion", freno.envolver(generador.bloquear_organizacion))
    hilo_a = Hilo("A", lambda: generar(ahora=HOY))
    hilo_b = Hilo("B", cancelar)
    try:
        hilo_a.start()
        assert freno.llego.wait(ESPERA), "A nunca llegó a bloquear la organización"
        hilo_b.start()
        # FOR SHARE con FOR SHARE no se esperan: la cancelación termina.
        hilo_b.join(ESPERA)
        assert not hilo_b.is_alive(), "la cancelación quedó esperando a la corrida"
    finally:
        freno.soltar.set()
    terminar(hilo_a, hilo_b)

    assert hilo_b.resultado is True
    assert (len(hilo_a.resultado.creadas), hilo_a.resultado.obsoletas) == (0, 1)
    assert not Alerta.objects.exists()


def test_la_cancelacion_espera_al_aviso_y_lo_invalida(monkeypatch):
    freno = Freno()
    # A se frena con la suscripción bloqueada y el aviso ya insertado, al
    # planificar sus entregas, antes de confirmar.
    monkeypatch.setattr(entregas, "planificar", freno.envolver(entregas.planificar))
    hilo_a = Hilo("A", lambda: generar(ahora=HOY))
    hilo_b = Hilo("B", cancelar)
    try:
        hilo_a.start()
        assert freno.llego.wait(ESPERA), "A nunca llegó a planificar"
        hilo_b.start()
        hasta_que_espere(hilo_b, "el bloqueo de la suscripción")
    finally:
        freno.soltar.set()
    terminar(hilo_a, hilo_b)

    assert hilo_b.resultado is True
    assert len(hilo_a.resultado.creadas) == 1
    (alerta,) = Alerta.objects.all()
    assert alerta.invalidada_en is not None and alerta.motivo_invalidacion == "no_vigente"
    entrega = EntregaAlerta.objects.get(alerta=alerta, canal="email")
    assert (entrega.estado, entrega.motivo) == ("descartada", "alerta_obsoleta")

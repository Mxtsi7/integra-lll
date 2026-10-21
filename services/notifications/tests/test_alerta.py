"""
FE-16 — Modelar alertas y estados de lectura.

Lo que tiene que quedar demostrado:

- la alerta pertenece a una organización y no se mezcla con otra
- los tres estados de lectura se comportan como dicen los requisitos
- un mismo evento no puede generar dos alertas (idempotencia de FE-24)
"""

import uuid
from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from notifications.models import Alerta

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")


def crear(org=ORG_A, tipo=Alerta.Tipo.PROXIMO_COBRO, **extra):
    extra.setdefault("titulo", "Netflix se cobra en 3 días")
    extra.setdefault("mensaje", "El cobro de 9.990 está programado para el 24.")
    return Alerta.objects.create(organizacion_id=org, tipo=tipo, **extra)


# ── Aislamiento ──────────────────────────────────────────────────────────


def test_la_alerta_pertenece_a_una_organizacion():
    alerta = crear()
    assert alerta.organizacion_id == ORG_A
    assert isinstance(alerta.id, uuid.UUID)


def test_las_alertas_de_una_organizacion_no_se_ven_desde_otra():
    crear(org=ORG_A)
    crear(org=ORG_B)
    assert Alerta.objects.filter(organizacion_id=ORG_A).count() == 1


# ── Estados de lectura ───────────────────────────────────────────────────


def test_nace_pendiente():
    alerta = crear()
    assert alerta.lectura == Alerta.Lectura.PENDIENTE
    assert alerta.pendiente is True
    assert alerta.leida_en is None
    assert alerta.revisada_en is None


def test_marcarla_leida_la_saca_de_pendientes():
    alerta = crear()
    alerta.marcar_leida()
    alerta.refresh_from_db()

    assert alerta.lectura == Alerta.Lectura.LEIDA
    assert alerta.pendiente is False
    assert alerta.leida_en is not None


def test_marcarla_leida_dos_veces_no_mueve_la_fecha():
    """Si la moviera, el frontend vería la alerta 'recién leída' cada vez."""
    alerta = crear()
    alerta.marcar_leida()
    primera = alerta.leida_en

    alerta.marcar_leida(cuando=timezone.now() + timedelta(hours=1))
    alerta.refresh_from_db()

    assert alerta.leida_en == primera


def test_revisarla_la_descarta_y_la_deja_leida():
    """RF-07: se descarta sin tocar la suscripción, y no sigue contando."""
    alerta = crear(tipo=Alerta.Tipo.ALZA_TARIFA)
    alerta.marcar_revisada()
    alerta.refresh_from_db()

    assert alerta.lectura == Alerta.Lectura.REVISADA
    assert alerta.pendiente is False
    assert alerta.revisada_en is not None
    # Una alerta revisada que la campana sigue contando no tendría sentido.
    assert alerta.leida_en is not None


def test_revisar_una_ya_leida_conserva_cuando_se_leyo():
    alerta = crear()
    alerta.marcar_leida()
    leida = alerta.leida_en

    alerta.marcar_revisada(cuando=timezone.now() + timedelta(hours=2))
    alerta.refresh_from_db()

    assert alerta.leida_en == leida
    assert alerta.revisada_en > leida


def test_revisarla_dos_veces_no_mueve_la_fecha():
    alerta = crear()
    alerta.marcar_revisada()
    primera = alerta.revisada_en

    alerta.marcar_revisada(cuando=timezone.now() + timedelta(hours=1))
    alerta.refresh_from_db()

    assert alerta.revisada_en == primera


# ── Idempotencia del consumidor (FE-24) ──────────────────────────────────


def test_un_evento_no_puede_generar_dos_alertas():
    """Regla 1 del catálogo: RabbitMQ entrega *al menos* una vez."""
    evento = uuid.uuid4()
    crear(evento_id=evento)

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            crear(evento_id=evento)


def test_dos_organizaciones_pueden_recibir_el_mismo_evento():
    """Un evento de alcance global llega a cada organización por separado."""
    evento = uuid.uuid4()
    crear(org=ORG_A, evento_id=evento)
    crear(org=ORG_B, evento_id=evento)
    assert Alerta.objects.filter(evento_id=evento).count() == 2


def test_las_alertas_sin_evento_no_chocan_entre_ellas():
    """La restricción es parcial: si no la fuera, solo cabría una sin evento."""
    crear()
    crear()
    assert Alerta.objects.filter(evento_id__isnull=True).count() == 2


# ── Forma de la alerta ───────────────────────────────────────────────────


@pytest.mark.parametrize("tipo", [t for t in Alerta.Tipo])
def test_todos_los_tipos_de_los_requisitos_se_pueden_crear(tipo):
    assert crear(tipo=tipo).tipo == tipo


def test_el_presupuesto_excedido_no_va_atado_a_una_suscripcion():
    """RF-13 es del conjunto, no de una suscripción."""
    alerta = crear(tipo=Alerta.Tipo.PRESUPUESTO_EXCEDIDO)
    assert alerta.suscripcion_id is None


def test_guarda_lo_propio_de_cada_tipo_en_datos():
    alerta = crear(
        tipo=Alerta.Tipo.ALZA_TARIFA,
        suscripcion_id=uuid.uuid4(),
        datos={"monto_anterior": "10000", "monto_nuevo": "10600"},
    )
    alerta.refresh_from_db()
    assert alerta.datos["monto_nuevo"] == "10600"


def test_la_suscripcion_es_un_uuid_suelto_no_una_clave_foranea():
    """ADR-002: la suscripción vive en el esquema de otro servicio."""
    campo = Alerta._meta.get_field("suscripcion_id")
    assert not campo.is_relation
    assert campo.null is True


def test_se_listan_de_la_mas_nueva_a_la_mas_vieja():
    vieja = crear(titulo="vieja")
    nueva = crear(titulo="nueva")
    assert list(Alerta.objects.all()) == [nueva, vieja]

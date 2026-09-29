"""Pruebas de las dos entidades del MER que faltaban: Proveedor y Cobro."""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction

from app.models import Cobro, Proveedor, Subscription

ORG_1 = uuid.UUID("11111111-1111-4111-8111-111111111111")
ORG_2 = uuid.UUID("22222222-2222-4222-8222-222222222222")


def crear_suscripcion(organizacion_id=ORG_1, monto="9990", **extra):
    return Subscription.objects.create(
        organizacion_id=organizacion_id,
        nombre=extra.pop("nombre", "Netflix"),
        monto=Decimal(monto),
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 10, 5),
        **extra,
    )


# ── Proveedor ────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_el_proveedor_es_un_catalogo_global_sin_organizacion():
    """Netflix es Netflix para todas las organizaciones (ver el glosario)."""
    proveedor = Proveedor.objects.create(nombre="Netflix")

    assert not hasattr(proveedor, "organizacion_id")
    assert proveedor.id is not None          # UUID de ModeloBase
    assert proveedor.creado_en is not None


@pytest.mark.django_db
def test_no_se_repite_un_proveedor():
    Proveedor.objects.create(nombre="Spotify")

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Proveedor.objects.create(nombre="Spotify")


@pytest.mark.django_db
def test_el_proveedor_usa_las_mismas_categorias_que_la_suscripcion():
    proveedor = Proveedor.objects.create(
        nombre="Netflix", categoria=Subscription.Categoria.STREAMING
    )

    assert proveedor.categoria == "streaming"
    assert Proveedor.objects.get(nombre="Netflix").get_categoria_display() == "Streaming"


# ── La suscripción y su proveedor ────────────────────────────────────

@pytest.mark.django_db
def test_la_suscripcion_puede_no_tener_proveedor():
    """Las que ya existen se cargaron a mano, sin catálogo: siguen valiendo."""
    suscripcion = crear_suscripcion()

    assert suscripcion.proveedor is None


@pytest.mark.django_db
def test_no_se_borra_un_proveedor_con_suscripciones():
    proveedor = Proveedor.objects.create(nombre="Netflix")
    crear_suscripcion(proveedor=proveedor)

    from django.db.models import ProtectedError

    with pytest.raises(ProtectedError):
        proveedor.delete()


# ── Cobro ────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_el_cobro_guarda_su_propio_monto_y_fecha():
    suscripcion = crear_suscripcion()

    cobro = Cobro.objects.create(
        organizacion_id=ORG_1,
        suscripcion=suscripcion,
        monto=Decimal("9990"),
        fecha=date(2026, 9, 5),
    )

    assert cobro.monto == Decimal("9990.00")
    assert cobro.moneda == "CLP"
    assert cobro.suscripcion == suscripcion
    assert suscripcion.cobros.count() == 1


@pytest.mark.django_db
def test_el_cobro_detecta_un_alza_de_precio():
    """Es para lo que existe el cobro: comparar lo cobrado con lo esperado."""
    suscripcion = crear_suscripcion(monto="9990")

    igual = Cobro.objects.create(
        organizacion_id=ORG_1, suscripcion=suscripcion,
        monto=Decimal("9990"), fecha=date(2026, 9, 5),
    )
    mas_caro = Cobro.objects.create(
        organizacion_id=ORG_1, suscripcion=suscripcion,
        monto=Decimal("12990"), fecha=date(2026, 10, 5),
    )

    assert igual.hubo_alza is False
    assert mas_caro.hubo_alza is True


@pytest.mark.django_db
def test_el_cobro_no_puede_ser_cero_ni_negativo():
    suscripcion = crear_suscripcion()

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Cobro.objects.create(
                organizacion_id=ORG_1, suscripcion=suscripcion,
                monto=Decimal("0"), fecha=date(2026, 9, 5),
            )


@pytest.mark.django_db
def test_los_cobros_pertenecen_a_una_organizacion():
    """RF-26: el cobro lleva organizacion_id, como todo lo que es del tenant."""
    suscripcion = crear_suscripcion(organizacion_id=ORG_1)
    Cobro.objects.create(
        organizacion_id=ORG_1, suscripcion=suscripcion,
        monto=Decimal("9990"), fecha=date(2026, 9, 5),
    )

    assert Cobro.objects.filter(organizacion_id=ORG_1).count() == 1
    assert Cobro.objects.filter(organizacion_id=ORG_2).count() == 0


@pytest.mark.django_db
def test_borrar_la_suscripcion_se_lleva_sus_cobros():
    """Un cobro sin su suscripción no significa nada."""
    suscripcion = crear_suscripcion()
    Cobro.objects.create(
        organizacion_id=ORG_1, suscripcion=suscripcion,
        monto=Decimal("9990"), fecha=date(2026, 9, 5),
    )

    suscripcion.delete()

    assert Cobro.objects.count() == 0


@pytest.mark.django_db
def test_los_cobros_salen_del_mas_nuevo_al_mas_viejo():
    suscripcion = crear_suscripcion()
    for dia in (5, 20, 12):
        Cobro.objects.create(
            organizacion_id=ORG_1, suscripcion=suscripcion,
            monto=Decimal("9990"), fecha=date(2026, 9, dia),
        )

    fechas = [c.fecha.day for c in Cobro.objects.all()]

    assert fechas == [20, 12, 5]

import uuid
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from app.models import Subscription


@pytest.mark.django_db
def test_seed_subscriptions_crea_cinco_ejemplos_para_la_organizacion():
    organizacion_id = uuid.uuid4()

    call_command("seed_subscriptions", organizacion_id=str(organizacion_id))

    suscripciones = Subscription.objects.filter(organizacion_id=organizacion_id)
    assert suscripciones.count() == 5
    assert set(suscripciones.values_list("nombre", flat=True)) == {
        "Netflix",
        "Spotify",
        "HBO Max",
        "iCloud",
        "Gimnasio",
    }
    assert set(suscripciones.values_list("estado", flat=True)) == {
        Subscription.Estado.ACTIVO,
        Subscription.Estado.PRUEBA,
        Subscription.Estado.POR_CONFIRMAR,
        Subscription.Estado.CANCELADO,
    }
    assert suscripciones.values("fecha_proximo_cobro").distinct().count() == 5

    hbo_max = suscripciones.get(nombre="HBO Max")
    assert hbo_max.fin_prueba == timezone.localdate() + timedelta(days=5)


@pytest.mark.django_db
def test_seed_subscriptions_es_idempotente_y_no_modifica_ejemplos_existentes():
    organizacion_id = uuid.uuid4()
    call_command("seed_subscriptions", organizacion_id=organizacion_id)
    netflix = Subscription.objects.get(
        organizacion_id=organizacion_id,
        nombre="Netflix",
    )
    netflix.activo = False
    netflix.save()
    monto_personalizado = netflix.monto

    call_command("seed_subscriptions", organizacion_id=organizacion_id)

    assert Subscription.objects.filter(organizacion_id=organizacion_id).count() == 5
    netflix.refresh_from_db()
    assert netflix.activo is False
    assert netflix.monto == monto_personalizado


@pytest.mark.django_db
def test_seed_subscriptions_exige_uuid_de_organizacion(monkeypatch):
    monkeypatch.delenv("SEED_ORGANIZACION_ID", raising=False)

    with pytest.raises(CommandError, match="Indica --organizacion-id"):
        call_command("seed_subscriptions")


@pytest.mark.django_db
def test_seed_subscriptions_lee_uuid_de_organizacion_del_entorno(monkeypatch):
    organizacion_id = uuid.uuid4()
    monkeypatch.setenv("SEED_ORGANIZACION_ID", str(organizacion_id))

    call_command("seed_subscriptions")

    assert Subscription.objects.filter(organizacion_id=organizacion_id).count() == 5


@pytest.mark.django_db
def test_seed_subscriptions_rechaza_uuid_invalido():
    with pytest.raises(CommandError, match="UUID de organización inválido"):
        call_command("seed_subscriptions", organizacion_id="no-es-un-uuid")

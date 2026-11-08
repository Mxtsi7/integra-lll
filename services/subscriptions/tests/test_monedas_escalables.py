from datetime import date
from decimal import Decimal
import uuid

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from app.models import Moneda, Presupuesto, Subscription
from events.trabajo import recalcular_resumen

pytestmark = pytest.mark.django_db
BASE = "/api/suscripciones/"


@pytest.fixture
def entorno(monkeypatch):
    monkeypatch.setattr("app.views.timezone.localdate", lambda: date(2026, 11, 1))
    Moneda.objects.create(codigo="EUR", nombre="Euro")
    org = uuid.uuid4()
    client = APIClient()
    client.credentials(HTTP_X_ORGANIZACION_ID=str(org))
    return client, org


def presupuesto(client, **extra):
    return client.post(BASE + "presupuesto/", {
        "mes": "2026-11", "moneda": "eur", "monto": "20.00", **extra,
    }, format="json")


def test_tercera_moneda_en_presupuesto_resumen_y_trabajo_derivado(entorno):
    client, org = entorno
    for tenant, moneda, monto in [(org, "EUR", "12.34"), (org, "CLP", "10000"), (uuid.uuid4(), "EUR", "999")]:
        Subscription.objects.create(
            organizacion_id=tenant, nombre="Servicio", moneda=moneda,
            monto=monto, fecha_proximo_cobro=date(2026, 11, 10), frecuencia="mensual", estado="activo",
        )
    respuesta = presupuesto(client)
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.data["moneda"] == "EUR"
    assert respuesta.data["monto"] == "20.00"
    assert presupuesto(client, monto="21.00").data["id"] == respuesta.data["id"]
    for recurso, campo in [("presupuesto", "total_esperado"), ("resumen", "total_estimado")]:
        resultado = client.get(BASE + recurso + "/?mes=2026-11&moneda=eur")
        assert resultado.status_code == 200, resultado.data
        assert Decimal(resultado.data[campo]) == Decimal("12.34")
    resumen = next(r for r in recalcular_resumen(org) if r.moneda == "EUR")
    resumen.full_clean()  # El agregado tampoco conserva un enum CLP/USD.
    assert resumen.total_mensual == Decimal("12.34")


def test_inactiva_conserva_presupuesto_y_lectura_pero_no_admite_asignacion_nueva(entorno):
    client, org = entorno
    assert presupuesto(client).status_code == 200
    Moneda.objects.filter(codigo="EUR").update(activo=False)
    assert presupuesto(client, monto="25.00").status_code == 200
    assert presupuesto(client, mes="2026-12").status_code == 400
    client.credentials(HTTP_X_ORGANIZACION_ID=str(uuid.uuid4()))
    assert presupuesto(client).status_code == 400
    client.credentials(HTTP_X_ORGANIZACION_ID=str(org))
    for recurso in ("presupuesto", "resumen"):
        assert client.get(BASE + recurso + "/?mes=2026-11&moneda=EUR").status_code == 200
    with pytest.raises(ValidationError, match="moneda"):
        Presupuesto.objects.create(organizacion_id=org, mes="2026-12", moneda="EUR", monto="10")
    existente = Presupuesto.objects.get(organizacion_id=org)
    existente.monto = Decimal("26.00")
    existente.save()


@pytest.mark.parametrize("codigo", ["ZZZ", "EU", "", "123"])
def test_rechaza_codigos_no_catalogados_sin_escrituras(entorno, codigo):
    client, org = entorno
    assert presupuesto(client, moneda=codigo).status_code == 400
    if codigo:
        for recurso in ("presupuesto", "resumen"):
            assert client.get(BASE + recurso + "/", {"moneda": codigo}).status_code == 400
    assert not Presupuesto.objects.filter(organizacion_id=org).exists()


def test_monto_con_mas_de_dos_decimales_no_se_redondea_en_silencio(entorno):
    client, _ = entorno
    assert presupuesto(client, monto="1.005").status_code == 400


@pytest.mark.django_db(transaction=True)
def test_migracion_conserva_codigos_e_importes():
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    executor = MigrationExecutor(connection)
    hojas = executor.loader.graph.leaf_nodes()
    anterior = [("app", "0014_trabajo_derivado")]
    try:
        executor.migrate(anterior)
        modelos = executor.loader.project_state(anterior).apps
        presupuesto = modelos.get_model("app", "Presupuesto").objects.create(
            organizacion_id=uuid.uuid4(), mes="2026-11", moneda="USD", monto="4.99",
        )
        executor = MigrationExecutor(connection)
        executor.migrate(hojas)
        actual = Presupuesto.objects.get(pk=presupuesto.pk)
        assert (actual.moneda, actual.monto) == ("USD", Decimal("4.99"))
    finally:
        MigrationExecutor(connection).migrate(hojas)

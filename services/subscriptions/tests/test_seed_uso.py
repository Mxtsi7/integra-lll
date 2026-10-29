import json
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command, CommandError
from django.db.models import Sum

from app.models import RegistroUso, Subscription
from app.serializers import SubscriptionSerializer

pytestmark = pytest.mark.django_db


def cargar(fecha="2026-01-29"):
    salida = StringIO()
    call_command("seed_uso", fecha_ref=fecha, stdout=salida)
    return json.loads(salida.getvalue())


def test_repetir_conserva_registros_y_minutos():
    primera = cargar()
    ids = set(RegistroUso.objects.values_list("id", flat=True))
    total = RegistroUso.objects.aggregate(total=Sum("minutos"))
    assert cargar() == primera
    assert set(RegistroUso.objects.values_list("id", flat=True)) == ids
    assert RegistroUso.objects.aggregate(total=Sum("minutos")) == total
    assert Subscription.objects.count() == 8


def test_escenarios_cruzan_ano_y_aislan_organizaciones(client):
    datos = cargar()
    org_a, org_b = datos["organizaciones"]
    assert org_a["organizacion_id"] != org_b["organizacion_id"]
    for org in datos["organizaciones"]:
        escenarios = org["escenarios"]
        for nombre, escenario in escenarios.items():
            sub = Subscription.objects.get(pk=escenario["suscripcion_id"])
            assert str(sub.organizacion_id) == org["organizacion_id"]
            assert sub.usos.count() == escenario["registros_esperados"]
            assert not sub.usos.exclude(organizacion_id=sub.organizacion_id).exists()
        assert Subscription.objects.get(pk=escenarios["sin_uso"]["suscripcion_id"]).ultima_actividad is None
        bajo = Subscription.objects.get(pk=escenarios["bajo"]["suscripcion_id"])
        assert {f.strftime("%Y-%m") for f in bajo.usos.values_list("fecha", flat=True)} == {"2025-11", "2025-12", "2026-01"}
    propia = org_a["escenarios"]["alto"]["suscripcion_id"]
    ajena = org_b["escenarios"]["alto"]["suscripcion_id"]
    headers = {"HTTP_X_ORGANIZACION_ID": org_a["organizacion_id"]}
    assert client.get(f"/api/suscripciones/{propia}/uso/", **headers).status_code == 200
    assert client.get(f"/api/suscripciones/{ajena}/uso/", **headers).status_code == 404


def test_cambio_mes_sin_nuevas_escrituras_no_arrastra_horas():
    datos = cargar()
    sid = datos["organizaciones"][0]["escenarios"]["alto"]["suscripcion_id"]
    sub = Subscription.objects.get(pk=sid)
    import datetime as dt
    with patch("app.serializers.timezone.localdate", return_value=dt.date(2026, 2, 1)):
        assert SubscriptionSerializer(sub).data["horas_uso_mes"] == "0.00"


@pytest.mark.parametrize("fecha", ["ayer", "2026-02-30", "0001-01-01", "9999-01-01"])
def test_fecha_invalida_no_escribe(fecha):
    with pytest.raises(CommandError):
        cargar(fecha)
    assert not Subscription.objects.exists()


def test_error_de_dominio_revierte_toda_la_carga():
    with patch.object(Subscription, "registrar_uso", side_effect=ValueError("fallo simulado")):
        with pytest.raises(ValueError):
            cargar()
    assert not Subscription.objects.exists()
    assert not RegistroUso.objects.exists()


def test_no_sobrescribe_uso_demo_editado():
    cargar()
    registro = RegistroUso.objects.first()
    RegistroUso.objects.filter(pk=registro.pk).update(minutos=999)
    cantidad = RegistroUso.objects.count()
    with pytest.raises(CommandError):
        cargar()
    assert RegistroUso.objects.count() == cantidad
    registro.refresh_from_db()
    assert registro.minutos == 999

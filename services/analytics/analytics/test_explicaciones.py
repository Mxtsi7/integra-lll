from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone

from analytics.models import RecomendacionDescartada, UmbralAhorro, UsoMensual
from analytics.test_recommendation_api import ORG, OTRA_ORG, crear_recomendacion

pytestmark = pytest.mark.django_db


def pedir(client, rec, org=ORG):
    return client.get(f"/api/recomendaciones/{getattr(rec, 'pk', rec)}/explicar/", HTTP_X_ORGANIZACION_ID=org)


@pytest.fixture
def recomendacion():
    UmbralAhorro.objects.create(moneda="CLP", monto="1000.00")
    return crear_recomendacion()


def test_explicacion_coincide_con_evidencia_y_no_modifica_hallazgo(client, recomendacion):
    datos = pedir(client, recomendacion).json()
    assert datos["fuente"] == "reglas"
    assert datos["estado"] == "disponible"
    assert datos["ahorro_estimado"] == 9990.0
    assert datos["motivo"] == recomendacion.motivo
    assert datos["base_calculo"] == recomendacion.base_calculo
    assert datos["evidencia"]["id"] == recomendacion.evidencia_id
    assert datos["evidencia"]["descripcion"] in datos["explicacion"]
    assert datos["motivo"] in datos["explicacion"]
    assert "9990.00 CLP" in datos["explicacion"]
    assert "no un ahorro confirmado" in datos["explicacion"]
    assert pedir(client, recomendacion).json() == datos
    recomendacion.refresh_from_db()
    assert recomendacion.ahorro_estimado == Decimal("9990.00")


@pytest.mark.parametrize("org", [OTRA_ORG, "", "invalida"])
def test_aislamiento_y_contexto(client, recomendacion, org):
    assert pedir(client, recomendacion, org).status_code == (404 if org == OTRA_ORG else 403)


@pytest.mark.parametrize("pk", ["invalido", str(uuid4())])
def test_uuid_invalido_o_inexistente_responde_404(client, pk):
    assert pedir(client, pk).status_code == 404


@pytest.mark.parametrize("campo", ["motivo", "base_calculo", "evidencia_id", "evidencia_descripcion"])
def test_sin_evidencia_suficiente_no_afirma_ahorro(client, recomendacion, campo):
    setattr(recomendacion, campo, " ")
    recomendacion.save(update_fields=[campo])
    datos = pedir(client, recomendacion).json()
    assert datos["estado"] == "datos_insuficientes"
    assert datos["ahorro_estimado"] is None
    assert datos["evidencia"] is None
    assert "9990" not in datos["explicacion"]
    assert datos["uso"] == "no_evaluado"


@pytest.mark.parametrize("dias,visible", [(30, False), (-1, True), (None, False)])
def test_descarte_aplica_la_misma_vigencia_del_listado(client, recomendacion, dias, visible):
    RecomendacionDescartada.objects.create(
        organizacion_id=ORG, recomendacion=recomendacion,
        vigente_hasta=timezone.now()+timedelta(days=dias) if dias is not None else None,
    )
    assert pedir(client, recomendacion).status_code == (200 if visible else 404)


@pytest.mark.parametrize("umbral,codigo", [("9990.00", 200), ("9990.01", 404), (None, 404)])
def test_limite_exacto_y_ausencia_de_umbral(client, recomendacion, umbral, codigo):
    if umbral is None:
        UmbralAhorro.objects.all().delete()
    else:
        UmbralAhorro.objects.update(monto=Decimal(umbral))
    assert pedir(client, recomendacion).status_code == codigo


def test_no_suma_monedas_ni_utiliza_umbral_de_otra(client, recomendacion):
    recomendacion.moneda = "USD"
    recomendacion.ahorro_estimado = Decimal("2.00")
    recomendacion.save()
    assert pedir(client, recomendacion).status_code == 404
    UmbralAhorro.objects.create(moneda="USD", monto="2.00")
    datos = pedir(client, recomendacion).json()
    assert datos["ahorro_estimado"] == 2.0
    assert "2.00 USD" in datos["explicacion"]


def test_estado_no_vigente_no_es_visible(client, recomendacion):
    recomendacion.estado = "descartada"
    recomendacion.save()
    assert pedir(client, recomendacion).status_code == 404


@pytest.mark.parametrize("minutos", [None, 0, 5, 2400])
def test_uso_ausente_cero_bajo_y_alto_no_inventa_puntajes(client, recomendacion, minutos):
    if minutos is not None:
        UsoMensual.objects.create(
            organizacion_id=ORG, suscripcion_id=recomendacion.suscripcion_id,
            mes=timezone.localdate().replace(day=1), minutos=minutos,
        )
    with patch("analytics.politica_ia.PoliticaIA.ejecutar", side_effect=AssertionError("No debe llamar IA")):
        respuesta = pedir(client, recomendacion)
    assert respuesta.status_code == 200
    assert respuesta.json()["uso"] == "no_evaluado"
    assert "puntaje" not in respuesta.json()
    assert respuesta.json()["ahorro_estimado"] == 9990.0

from datetime import datetime, timedelta, timezone as tz
from decimal import Decimal
from uuid import uuid4

import pytest
from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from app.models import Contratacion, Organizacion, Plan, User
from app.planes import plan_vigente, transicionar

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def hash_de_prueba(settings):
    settings.PBKDF2_ITERACIONES = 1000


@pytest.fixture
def titular():
    org = Organizacion.objects.create(nombre="Hogar demo")
    return User.objects.create_user(email="planes@example.test", password="Prueba123", nombre="Demo", organizacion=org, rol="titular")


@pytest.fixture
def contrato(titular):
    return Contratacion.objects.create(organizacion=titular.organizacion, solicitante=titular,
        plan_id="premium", clave_idempotencia=uuid4(), importe=Decimal("4990.00"), moneda="CLP")


def me(usuario):
    return APIClient().get("/api/usuarios/me/", HTTP_X_USUARIO_ID=str(usuario.pk), HTTP_X_ORGANIZACION_ID=str(usuario.organizacion_id))


def test_catalogo_inicial_es_demo_y_decimal():
    assert set(Plan.objects.values_list("codigo", flat=True)) == {"free", "premium"}
    assert Plan.objects.get(pk="free").precio == Decimal("0.00")
    assert Plan.objects.get(pk="premium").precio_demo is True


def test_sin_pago_el_plan_es_free(contrato, titular):
    assert me(titular).data["plan"] == "free"
    transicionar(contrato.pk, "fallida")
    assert me(titular).data["plan"] == "free"


def test_pago_persistido_habilita_la_organizacion_y_es_idempotente(contrato, titular):
    ahora = datetime(2026, 1, 31, 12, tzinfo=tz.utc)
    pagada = transicionar(contrato.pk, "exitosa", ahora=ahora)
    assert pagada.vigente_hasta == datetime(2026, 2, 28, 12, tzinfo=tz.utc)
    assert transicionar(contrato.pk, "exitosa", ahora=ahora + timedelta(days=1)).vigente_hasta == pagada.vigente_hasta
    assert plan_vigente(titular.organizacion_id, ahora=ahora) == "premium"
    assert plan_vigente(titular.organizacion_id, ahora=pagada.vigente_hasta) == "free"


def test_cancelacion_conserva_periodo_pagado(contrato):
    pagada = transicionar(contrato.pk, "exitosa")
    transicionar(contrato.pk, "cancelada")
    assert plan_vigente(contrato.organizacion_id) == "premium"
    assert plan_vigente(contrato.organizacion_id, ahora=pagada.vigente_hasta) == "free"


@pytest.mark.parametrize("primero,despues", [("fallida", "exitosa"), ("cancelada", "exitosa"), ("exitosa", "pendiente"), ("pendiente", "inventado")])
def test_transicion_invalida_no_modifica_contrato(contrato, primero, despues):
    if primero != "pendiente":
        transicionar(contrato.pk, primero)
    with pytest.raises(ValidationError):
        transicionar(contrato.pk, despues)
    contrato.refresh_from_db()
    assert contrato.estado == primero


def test_todos_los_miembros_comparten_plan_sin_poder_elegirlo(contrato, titular):
    miembro = User.objects.create_user(email="miembro@example.test", nombre="Miembro", password="Prueba123", organizacion=titular.organizacion, rol="integrante")
    ajeno = User.objects.create_user(email="ajeno@example.test", nombre="Ajeno", password="Prueba123", organizacion=Organizacion.objects.create(nombre="Otro"))
    transicionar(contrato.pk, "exitosa")
    assert me(miembro).data["plan"] == me(titular).data["plan"] == "premium"
    assert me(ajeno).data["plan"] == "free"
    respuesta = APIClient().patch("/api/usuarios/me/", {"nombre": "Otro", "plan": "premium"}, format="json", HTTP_X_USUARIO_ID=str(ajeno.pk), HTTP_X_ORGANIZACION_ID=str(ajeno.organizacion_id))
    assert respuesta.status_code == 400
    assert me(ajeno).data["plan"] == "free"


def test_periodo_incompleto_no_se_persiste(contrato):
    with pytest.raises(IntegrityError), transaction.atomic():
        Contratacion.objects.filter(pk=contrato.pk).update(vigente_desde=datetime.now(tz.utc))


def test_renovacion_no_acorta_periodo_ya_pagado(contrato):
    primera = transicionar(contrato.pk, "exitosa")
    siguiente = Contratacion.objects.create(organizacion=contrato.organizacion, plan_id="premium", clave_idempotencia=uuid4(), importe=contrato.importe, moneda="CLP")
    segunda = transicionar(siguiente.pk, "exitosa")
    assert segunda.vigente_desde == primera.vigente_hasta
    assert plan_vigente(contrato.organizacion_id, ahora=primera.vigente_hasta) == "premium"

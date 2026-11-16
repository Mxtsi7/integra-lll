"""S3-VI-15 contra PostgreSQL real.

El endpoint usa solo el ORM, pero la integración se exige igual: el
``conftest`` puede degradar a SQLite en local y una suite que solo pasó ahí no
demuestra el comportamiento sobre la base de producción. Esta prueba crea
suscripciones y cobros reales y comprueba la separación por moneda, el gasto
de suscripciones dadas de baja y la proyección permitida.

Con ``EXIGIR_INTEGRACION_USO=1`` la falta de PostgreSQL o de la bandera falla;
no se omite en silencio.
"""

from __future__ import annotations

import datetime as dt
import os
import uuid
from calendar import monthrange
from decimal import Decimal

import pytest
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from app.models import Cobro, Subscription

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

RUTA = "/api/suscripciones/gasto-por-moneda/"


def _no_disponible(motivo: str) -> None:
    if os.environ.get("EXIGIR_INTEGRACION_USO") == "1":
        pytest.fail(f"EXIGIR_INTEGRACION_USO=1 exige la integración real: {motivo}")
    pytest.skip(motivo)


@pytest.fixture(scope="session")
def requiere_integracion():
    if os.environ.get("INTEGRACION_USO") != "1":
        _no_disponible("define INTEGRACION_USO=1 para ejecutar la integración")
    if connection.vendor != "postgresql":
        _no_disponible("estas pruebas necesitan PostgreSQL real, no SQLite")


@pytest.fixture(scope="session")
def mes_local(requiere_integracion) -> tuple[dt.date, dt.date, dt.date, str]:
    """Devuelve (hoy, inicio, fin, "YYYY-MM") del mes local."""
    hoy = timezone.localdate()
    inicio = hoy.replace(day=1)
    fin = dt.date(hoy.year, hoy.month, monthrange(hoy.year, hoy.month)[1])
    return hoy, inicio, fin, f"{hoy:%Y-%m}"


def _suscripcion(
    *,
    org: uuid.UUID = ORG_A,
    nombre: str,
    monto: str,
    moneda: str = "CLP",
    fecha_proximo_cobro: dt.date,
    estado: str = Subscription.Estado.ACTIVO,
    activo: bool = True,
) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=org,
        nombre=nombre,
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=fecha_proximo_cobro,
        categoria="streaming",
        estado=estado,
        activo=activo,
    )


def _cobro(
    *, suscripcion: Subscription, monto: str, fecha: dt.date, moneda: str | None = None
) -> Cobro:
    return Cobro.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        monto=Decimal(monto),
        moneda=moneda or suscripcion.moneda,
        fecha=fecha,
    )


def _pedir(org: uuid.UUID = ORG_A, **params):
    return APIClient().get(
        RUTA,
        params,
        HTTP_X_ORGANIZACION_ID=str(org),
    )


def _por_codigo(respuesta) -> dict[str, dict]:
    return {fila["moneda"]: fila for fila in respuesta.data["monedas"]}


class TestGastoPorMonedaPostgreSQL:
    def test_separa_monedas_y_no_inventa_un_total_conjunto(self, mes_local):
        hoy, inicio, _, periodo = mes_local
        sub_clp = _suscripcion(
            nombre="Streaming local", monto="10000.00", fecha_proximo_cobro=inicio
        )
        sub_usd = _suscripcion(
            nombre="SaaS global",
            monto="25.50",
            moneda="USD",
            fecha_proximo_cobro=inicio,
        )
        _cobro(suscripcion=sub_clp, monto="10000.00", fecha=hoy)
        _cobro(suscripcion=sub_usd, monto="25.50", fecha=hoy)

        respuesta = _pedir(mes=periodo)

        assert respuesta.status_code == 200, respuesta.data
        assert set(respuesta.data) == {"periodo", "monedas"}
        monedas = _por_codigo(respuesta)
        assert set(monedas) == {"CLP", "USD"}
        assert Decimal(str(monedas["CLP"]["gasto_real"])) == Decimal("10000.00")
        assert Decimal(str(monedas["USD"]["gasto_real"])) == Decimal("25.50")
        assert all("total" not in fila for fila in respuesta.data["monedas"])

    def test_cobro_de_suscripcion_dada_de_baja_cuenta_como_gasto_real(
        self, mes_local
    ):
        hoy, _, _, periodo = mes_local
        sub = _suscripcion(
            nombre="Dada de baja",
            monto="7000.00",
            fecha_proximo_cobro=hoy,
            activo=False,
        )
        _cobro(suscripcion=sub, monto="7000.00", fecha=hoy)

        fila = _por_codigo(_pedir(mes=periodo))["CLP"]

        assert Decimal(str(fila["gasto_real"])) == Decimal("7000.00")
        assert fila["conteo_cobros"] == 1
        assert fila["conteo_suscripciones"] == 1

    def test_proyecta_solo_activas_no_canceladas_sin_cobro(self, mes_local):
        hoy, _, _, periodo = mes_local
        _suscripcion(nombre="Proyectada", monto="3000.00", fecha_proximo_cobro=hoy)
        _suscripcion(
            nombre="Cancelada",
            monto="9999.00",
            fecha_proximo_cobro=hoy,
            estado=Subscription.Estado.CANCELADO,
        )
        _suscripcion(
            nombre="Inactiva",
            monto="8888.00",
            fecha_proximo_cobro=hoy,
            activo=False,
        )

        fila = _por_codigo(_pedir(mes=periodo))["CLP"]

        assert Decimal(str(fila["gasto_real"])) == Decimal("0.00")
        assert Decimal(str(fila["gasto_proyectado"])) == Decimal("3000.00")
        assert Decimal(str(fila["total_estimado"])) == Decimal("3000.00")
        assert fila["conteo_suscripciones"] == 1

    def test_no_mezcla_organizaciones(self, mes_local):
        hoy, inicio, _, periodo = mes_local
        sub_a = _suscripcion(
            nombre="De A", monto="1000.00", fecha_proximo_cobro=inicio
        )
        _cobro(suscripcion=sub_a, monto="1000.00", fecha=hoy)

        sub_b = _suscripcion(
            org=ORG_B, nombre="De B", monto="77777.00", fecha_proximo_cobro=inicio
        )
        _cobro(suscripcion=sub_b, monto="77777.00", fecha=hoy)

        fila_a = _por_codigo(_pedir(org=ORG_A, mes=periodo))["CLP"]
        fila_b = _por_codigo(_pedir(org=ORG_B, mes=periodo))["CLP"]

        assert Decimal(str(fila_a["gasto_real"])) == Decimal("1000.00")
        assert fila_a["conteo_suscripciones"] == 1
        assert Decimal(str(fila_b["gasto_real"])) == Decimal("77777.00")
        assert fila_b["conteo_suscripciones"] == 1

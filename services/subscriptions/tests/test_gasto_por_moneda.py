"""S3-VI-15 — gasto del periodo separado por moneda.

Lo que estas pruebas protegen:

* **Nunca se suman monedas distintas.** La respuesta trae una fila por código
  y no existe un total entre divisas.
* **El gasto real incluye cobros ocurridos aunque la suscripción se haya
  dado de baja después.** El dinero se gastó; una baja lógica no lo borra.
* **La proyección solo considera suscripciones activas y no canceladas** sin
  un cobro ya registrado en el periodo.
* Toda consulta filtra por la organización autenticada.
"""

import datetime as dt
import uuid
from calendar import monthrange
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from app.models import Cobro, Subscription

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

RUTA = "/api/suscripciones/gasto-por-moneda/"


def _mes(desplazamiento: int = 0) -> tuple[dt.date, dt.date, str]:
    """Devuelve (inicio, fin, "YYYY-MM") del mes local desplazado."""
    hoy = timezone.localdate()
    indice = hoy.year * 12 + hoy.month - 1 + desplazamiento
    anio, mes = divmod(indice, 12)
    mes += 1
    inicio = dt.date(anio, mes, 1)
    fin = dt.date(anio, mes, monthrange(anio, mes)[1])
    return inicio, fin, f"{anio:04d}-{mes:02d}"


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
    *,
    suscripcion: Subscription,
    monto: str,
    fecha: dt.date,
    moneda: str | None = None,
) -> Cobro:
    return Cobro.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        monto=Decimal(monto),
        moneda=moneda or suscripcion.moneda,
        fecha=fecha,
    )


def _get(*, org: str | None = str(ORG_A), **params):
    return APIClient().get(
        RUTA,
        params,
        HTTP_X_ORGANIZACION_ID=org if org is not None else "",
    )


def _por_codigo(respuesta) -> dict[str, dict]:
    return {fila["moneda"]: fila for fila in respuesta.data["monedas"]}


# ══════════════════════════════════════════════════════════════════════
# Contrato del endpoint
# ══════════════════════════════════════════════════════════════════════


class TestContratoGastoPorMoneda:
    def test_sin_contexto_de_organizacion_responde_403(self):
        respuesta = _get(org=None, mes=_mes()[2])
        assert respuesta.status_code == 403

    @pytest.mark.parametrize("mes", ["2026-13", "2026-1", "octubre", "2026-00"])
    def test_mes_invalido_responde_400(self, mes):
        respuesta = _get(mes=mes)
        assert respuesta.status_code == 400
        assert "mes" in respuesta.data

    def test_sin_mes_usa_el_mes_local_actual(self):
        respuesta = _get()
        assert respuesta.status_code == 200
        assert respuesta.data["periodo"] == _mes()[2]
        assert respuesta.data["monedas"] == []

    def test_no_expone_un_total_entre_monedas(self):
        inicio, _, periodo = _mes()
        sub = _suscripcion(nombre="Streaming", monto="10000.00", fecha_proximo_cobro=inicio)
        _cobro(suscripcion=sub, monto="10000.00", fecha=inicio)

        respuesta = _get(mes=periodo)

        assert respuesta.status_code == 200
        assert set(respuesta.data) == {"periodo", "monedas"}
        assert all("total" not in fila for fila in respuesta.data["monedas"])


# ══════════════════════════════════════════════════════════════════════
# Separación por moneda
# ══════════════════════════════════════════════════════════════════════


class TestSeparacionPorMoneda:
    def test_agrupa_y_no_mezcla_clp_con_usd(self):
        inicio, _, periodo = _mes()
        sub_clp = _suscripcion(
            nombre="Streaming local", monto="10000.00", fecha_proximo_cobro=inicio
        )
        sub_usd = _suscripcion(
            nombre="SaaS global",
            monto="25.50",
            moneda="USD",
            fecha_proximo_cobro=inicio,
        )
        _cobro(suscripcion=sub_clp, monto="10000.00", fecha=inicio)
        _cobro(suscripcion=sub_usd, monto="25.50", fecha=inicio)

        respuesta = _get(mes=periodo)

        assert respuesta.status_code == 200
        assert [fila["moneda"] for fila in respuesta.data["monedas"]] == ["CLP", "USD"]
        monedas = _por_codigo(respuesta)
        assert Decimal(str(monedas["CLP"]["gasto_real"])) == Decimal("10000.00")
        assert Decimal(str(monedas["USD"]["gasto_real"])) == Decimal("25.50")
        assert Decimal(str(monedas["CLP"]["total_estimado"])) == Decimal("10000.00")
        assert Decimal(str(monedas["USD"]["total_estimado"])) == Decimal("25.50")

    def test_normaliza_el_codigo_a_mayusculas_y_agrupa(self):
        """La normalización es defensiva: el catálogo ya exige mayúsculas.

        Se inserta con ``bulk_create`` para saltar la validación de catálogo y
        comprobar que una fila histórica en minúsculas no parte el gasto en dos
        monedas distintas.
        """
        inicio, _, periodo = _mes()
        sub = Subscription(
            id=uuid.uuid4(),
            organizacion_id=ORG_A,
            nombre="Minúsculas",
            monto=Decimal("1000.00"),
            moneda="clp",
            frecuencia=Subscription.Frecuencia.MENSUAL,
            fecha_proximo_cobro=inicio,
            categoria="streaming",
            estado=Subscription.Estado.ACTIVO,
            activo=True,
        )
        Subscription.objects.bulk_create([sub])
        Cobro.objects.bulk_create(
            [
                Cobro(
                    id=uuid.uuid4(),
                    organizacion_id=ORG_A,
                    suscripcion=sub,
                    monto=Decimal("1000.00"),
                    moneda="clp",
                    fecha=inicio,
                )
            ]
        )

        respuesta = _get(mes=periodo)

        assert [fila["moneda"] for fila in respuesta.data["monedas"]] == ["CLP"]
        assert Decimal(str(respuesta.data["monedas"][0]["gasto_real"])) == Decimal(
            "1000.00"
        )

    def test_una_suscripcion_con_dos_cobros_cuenta_una_sola_vez(self):
        inicio, _, periodo = _mes()
        sub = _suscripcion(nombre="Doble", monto="5000.00", fecha_proximo_cobro=inicio)
        _cobro(suscripcion=sub, monto="3000.00", fecha=inicio)
        _cobro(suscripcion=sub, monto="2000.00", fecha=inicio)

        fila = _por_codigo(_get(mes=periodo))["CLP"]

        assert Decimal(str(fila["gasto_real"])) == Decimal("5000.00")
        assert fila["conteo_cobros"] == 2
        assert fila["conteo_suscripciones"] == 1


# ══════════════════════════════════════════════════════════════════════
# Gasto real vs proyección
# ══════════════════════════════════════════════════════════════════════


class TestGastoRealYProyeccion:
    def test_cobro_de_suscripcion_dada_de_baja_sigue_siendo_gasto_real(self):
        inicio, _, periodo = _mes()
        sub = _suscripcion(
            nombre="Dada de baja",
            monto="7000.00",
            fecha_proximo_cobro=inicio,
            activo=False,
        )
        _cobro(suscripcion=sub, monto="7000.00", fecha=inicio)

        fila = _por_codigo(_get(mes=periodo))["CLP"]

        assert Decimal(str(fila["gasto_real"])) == Decimal("7000.00")
        assert fila["conteo_cobros"] == 1
        assert fila["conteo_suscripciones"] == 1

    def test_proyecta_solo_activas_no_canceladas_y_sin_cobro(self):
        hoy = timezone.localdate()
        _, _, periodo = _mes()
        _suscripcion(
            nombre="Proyectada", monto="3000.00", fecha_proximo_cobro=hoy
        )
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

        fila = _por_codigo(_get(mes=periodo))["CLP"]

        assert Decimal(str(fila["gasto_real"])) == Decimal("0.00")
        assert Decimal(str(fila["gasto_proyectado"])) == Decimal("3000.00")
        assert Decimal(str(fila["total_estimado"])) == Decimal("3000.00")
        assert fila["conteo_cobros"] == 0
        assert fila["conteo_suscripciones"] == 1

    def test_una_suscripcion_ya_cobrada_no_se_proyecta_de_nuevo(self):
        hoy = timezone.localdate()
        _, _, periodo = _mes()
        sub = _suscripcion(
            nombre="Ya cobrada", monto="4000.00", fecha_proximo_cobro=hoy
        )
        _cobro(suscripcion=sub, monto="4000.00", fecha=hoy)

        fila = _por_codigo(_get(mes=periodo))["CLP"]

        assert Decimal(str(fila["gasto_real"])) == Decimal("4000.00")
        assert Decimal(str(fila["gasto_proyectado"])) == Decimal("0.00")
        assert Decimal(str(fila["total_estimado"])) == Decimal("4000.00")
        assert fila["conteo_suscripciones"] == 1

    def test_mezcla_de_cobros_y_proyecciones_mantiene_la_moneda(self):
        hoy = timezone.localdate()
        inicio, _, periodo = _mes()
        sub_clp = _suscripcion(
            nombre="Real CLP", monto="10000.00", fecha_proximo_cobro=inicio
        )
        _cobro(suscripcion=sub_clp, monto="10000.00", fecha=inicio)
        _suscripcion(nombre="Proyectada CLP", monto="2000.00", fecha_proximo_cobro=hoy)
        sub_usd = _suscripcion(
            nombre="Real USD",
            monto="10.00",
            moneda="USD",
            fecha_proximo_cobro=inicio,
        )
        _cobro(suscripcion=sub_usd, monto="10.00", fecha=inicio)

        monedas = _por_codigo(_get(mes=periodo))

        assert Decimal(str(monedas["CLP"]["gasto_real"])) == Decimal("10000.00")
        assert Decimal(str(monedas["CLP"]["gasto_proyectado"])) == Decimal("2000.00")
        assert Decimal(str(monedas["CLP"]["total_estimado"])) == Decimal("12000.00")
        assert monedas["CLP"]["conteo_suscripciones"] == 2
        assert Decimal(str(monedas["USD"]["gasto_real"])) == Decimal("10.00")
        assert Decimal(str(monedas["USD"]["gasto_proyectado"])) == Decimal("0.00")
        assert monedas["USD"]["conteo_suscripciones"] == 1


# ══════════════════════════════════════════════════════════════════════
# Aislamiento por organización
# ══════════════════════════════════════════════════════════════════════


class TestAislamientoTenant:
    def test_no_incluye_cobros_ni_suscripciones_de_otra_organizacion(self):
        inicio, _, periodo = _mes()
        sub_a = _suscripcion(
            nombre="De A", monto="1000.00", fecha_proximo_cobro=inicio
        )
        _cobro(suscripcion=sub_a, monto="1000.00", fecha=inicio)

        sub_b = _suscripcion(
            org=ORG_B, nombre="De B", monto="77777.00", fecha_proximo_cobro=inicio
        )
        _cobro(suscripcion=sub_b, monto="77777.00", fecha=inicio)
        _suscripcion(
            org=ORG_B, nombre="Proyectada B", monto="55555.00",
            fecha_proximo_cobro=timezone.localdate(),
        )

        fila_a = _por_codigo(_get(org=str(ORG_A), mes=periodo))["CLP"]
        fila_b = _por_codigo(_get(org=str(ORG_B), mes=periodo))["CLP"]

        assert Decimal(str(fila_a["gasto_real"])) == Decimal("1000.00")
        assert fila_a["conteo_suscripciones"] == 1
        assert Decimal(str(fila_b["gasto_real"])) == Decimal("77777.00")
        assert Decimal(str(fila_b["gasto_proyectado"])) == Decimal("55555.00")
        assert fila_b["conteo_suscripciones"] == 2

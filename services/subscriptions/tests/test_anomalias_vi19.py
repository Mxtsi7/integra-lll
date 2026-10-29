"""Pruebas de aceptación VI-19: alzas de tarifa y posibles dobles cobros.

Reglas fijadas por la tarjeta:

* alza = monto **estrictamente mayor** que el promedio de los 3 meses
  previos + 5 %, con al menos 2 cobros previos;
* 10.000 → 10.600 alerta y 10.000 → 10.500 no;
* el primer (y el segundo) cobro no pueden ser un alza;
* doble cobro = mismo servicio a **menos de 5 días**; el día 5 de diferencia
  alerta y el día 6 no;
* reprocesar el mismo cobro no duplica hallazgos.
"""

from datetime import date, timedelta
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.anomalias import detectar_anomalias
from app.models import Cobro, HallazgoCobro, Subscription


def crear_suscripcion(
    org_id: uuid.UUID,
    *,
    nombre: str = "Servicio",
    monto: str = "10000.00",
) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal(monto),
        moneda="CLP",
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 8, 5),
    )


def crear_cobro(
    suscripcion: Subscription,
    fecha: date,
    monto: str,
) -> Cobro:
    return Cobro.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        monto=Decimal(monto),
        moneda="CLP",
        fecha=fecha,
    )


@pytest.mark.django_db
class TestAlzaTarifa:
    def test_alza_de_mas_de_cinco_por_ciento_alerta(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 6, 5), "10000.00")
        crear_cobro(suscripcion, date(2026, 7, 5), "10000.00")
        nuevo = crear_cobro(suscripcion, date(2026, 8, 5), "10600.00")

        hallazgo = HallazgoCobro.objects.get(
            suscripcion=suscripcion,
            tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
        )

        assert hallazgo.cobro_id == nuevo.id
        assert hallazgo.monto_referencia == Decimal("10000.00")
        assert hallazgo.porcentaje_variacion == Decimal("6.00")
        assert hallazgo.detalle["cantidad_previos"] == 2

    def test_exactamente_cinco_por_ciento_no_alerta(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 6, 5), "10000.00")
        crear_cobro(suscripcion, date(2026, 7, 5), "10000.00")
        crear_cobro(suscripcion, date(2026, 8, 5), "10500.00")

        assert not HallazgoCobro.objects.filter(
            suscripcion=suscripcion,
            tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
        ).exists()

    def test_el_primer_cobro_nunca_es_alza(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)

        crear_cobro(suscripcion, date(2026, 8, 5), "50000.00")

        assert not HallazgoCobro.objects.exists()

    def test_con_un_solo_cobro_previo_tampoco_alerta(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 7, 5), "10000.00")

        crear_cobro(suscripcion, date(2026, 8, 5), "20000.00")

        assert not HallazgoCobro.objects.filter(
            tipo=HallazgoCobro.Tipo.ALZA_TARIFA
        ).exists()

    def test_promedio_usa_los_tres_cobros_previos_mas_recientes(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 1, 5), "1000.00")
        crear_cobro(suscripcion, date(2026, 6, 5), "10000.00")
        crear_cobro(suscripcion, date(2026, 7, 5), "10000.00")

        crear_cobro(suscripcion, date(2026, 8, 5), "11000.00")

        # Promedio de 10000 y 10000: el cobro de enero queda fuera de la
        # ventana de 3 meses tanto en julio como en agosto.
        hallazgo = HallazgoCobro.objects.get(
            tipo=HallazgoCobro.Tipo.ALZA_TARIFA
        )
        assert hallazgo.monto_referencia == Decimal("10000.00")

    def test_cobros_de_otra_suscripcion_u_organizacion_no_cuentan(self) -> None:
        org = uuid.uuid4()
        propia = crear_suscripcion(org, nombre="Servicio")
        crear_cobro(propia, date(2026, 7, 5), "10000.00")

        otra_org = uuid.uuid4()
        ajena = crear_suscripcion(otra_org, nombre="Servicio")
        crear_cobro(ajena, date(2026, 6, 5), "10000.00")
        crear_cobro(ajena, date(2026, 7, 5), "10000.00")

        crear_cobro(propia, date(2026, 8, 5), "20000.00")

        assert not HallazgoCobro.objects.filter(
            suscripcion=propia,
            tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
        ).exists()


@pytest.mark.django_db
class TestDobleCobro:
    def test_cuatro_dias_de_diferencia_alerta(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        primero = crear_cobro(suscripcion, date(2026, 8, 1), "10000.00")
        segundo = crear_cobro(suscripcion, date(2026, 8, 5), "10000.00")

        hallazgo = HallazgoCobro.objects.get(
            suscripcion=suscripcion,
            tipo=HallazgoCobro.Tipo.DOBLE_COBRO,
        )

        assert hallazgo.detalle["dias_diferencia"] == 4
        assert {hallazgo.cobro_id, hallazgo.cobro_relacionado_id} == {
            primero.id,
            segundo.id,
        }

    def test_cinco_dias_de_diferencia_no_alerta(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 8, 1), "10000.00")
        crear_cobro(suscripcion, date(2026, 8, 6), "10000.00")

        assert not HallazgoCobro.objects.filter(
            suscripcion=suscripcion,
            tipo=HallazgoCobro.Tipo.DOBLE_COBRO,
        ).exists()

    def test_cargos_de_otra_organizacion_no_generan_doble_cobro(self) -> None:
        org = uuid.uuid4()
        propia = crear_suscripcion(org)
        ajena = crear_suscripcion(uuid.uuid4())

        crear_cobro(ajena, date(2026, 8, 1), "10000.00")
        crear_cobro(propia, date(2026, 8, 2), "10000.00")

        assert not HallazgoCobro.objects.filter(
            suscripcion=propia,
            tipo=HallazgoCobro.Tipo.DOBLE_COBRO,
        ).exists()


@pytest.mark.django_db
class TestDeduplicacionYRevision:
    def test_reprocesar_el_mismo_cobro_no_duplica_el_alza(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 6, 5), "10000.00")
        crear_cobro(suscripcion, date(2026, 7, 5), "10000.00")
        nuevo = crear_cobro(suscripcion, date(2026, 8, 5), "10600.00")

        detectar_anomalias(nuevo)
        detectar_anomalias(nuevo)

        assert (
            HallazgoCobro.objects.filter(
                suscripcion=suscripcion,
                tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
            ).count()
            == 1
        )

    def test_reprocesar_el_mismo_par_no_duplica_el_doble_cobro(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 8, 1), "10000.00")
        segundo = crear_cobro(suscripcion, date(2026, 8, 5), "10000.00")

        detectar_anomalias(segundo)
        detectar_anomalias(segundo)

        assert (
            HallazgoCobro.objects.filter(
                suscripcion=suscripcion,
                tipo=HallazgoCobro.Tipo.DOBLE_COBRO,
            ).count()
            == 1
        )

    def test_marcar_revisado_no_cambia_el_estado_de_la_suscripcion(self) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        crear_cobro(suscripcion, date(2026, 8, 1), "10000.00")
        crear_cobro(suscripcion, date(2026, 8, 5), "10000.00")
        hallazgo = HallazgoCobro.objects.get(
            tipo=HallazgoCobro.Tipo.DOBLE_COBRO
        )

        cliente = APIClient()
        respuesta = cliente.post(
            f"/api/hallazgos/{hallazgo.id}/revisar/",
            headers={
                "X-Organizacion-Id": str(org),
                "X-Usuario-Id": "42",
                "X-Rol": "titular",
            },
        )

        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta.data["estado"] == HallazgoCobro.Estado.REVISADA
        assert respuesta.data["revisado_por"] == 42
        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO

    def test_listado_de_hallazgos_aisla_por_tenant(self) -> None:
        org = uuid.uuid4()
        propia = crear_suscripcion(org)
        ajena = crear_suscripcion(uuid.uuid4())
        crear_cobro(propia, date(2026, 8, 1), "10000.00")
        crear_cobro(propia, date(2026, 8, 5), "10000.00")
        crear_cobro(ajena, date(2026, 8, 1), "10000.00")
        crear_cobro(ajena, date(2026, 8, 5), "10000.00")

        cliente = APIClient()
        respuesta = cliente.get(
            "/api/hallazgos/",
            headers={"X-Organizacion-Id": str(org)},
        )

        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta.data["count"] == 1
        assert respuesta.data["results"][0]["suscripcion_id"] == str(propia.id)


def test_la_ventana_de_doble_cobro_es_estricta() -> None:
    """Documenta el borde con fechas puras: 4 días sí, 5 días no."""
    assert abs((date(2026, 8, 5) - date(2026, 8, 1)).days) == 4
    assert abs((date(2026, 8, 6) - date(2026, 8, 1)).days) == 5
    assert abs((date(2026, 8, 7) - date(2026, 8, 1)).days) == 6
    # La constante del módulo se importa acá para que el borde quede atado a
    # la regla y no a un número mágico de la prueba.
    from app.anomalias import DIAS_DOBLE_COBRO

    assert DIAS_DOBLE_COBRO == 5
    assert timedelta(days=DIAS_DOBLE_COBRO - 1).days == 4

"""Pruebas del calendario mensual de cobros."""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Cobro, Subscription


@pytest.mark.django_db
class TestCalendarioCobros:
    @pytest.fixture(autouse=True)
    def fijar_hoy(self, monkeypatch):
        monkeypatch.setattr("app.views.timezone.localdate", lambda: date(2024, 1, 1))

    def setup_method(self):
        self.client = APIClient()
        self.organizacion = uuid.uuid4()
        self.otra_organizacion = uuid.uuid4()
        self.headers = {"X-Organizacion-Id": str(self.organizacion)}

    def crear_suscripcion(
        self,
        *,
        nombre="Servicio",
        fecha=date(2026, 10, 15),
        frecuencia=Subscription.Frecuencia.MENSUAL,
        organizacion_id=None,
        estado=Subscription.Estado.ACTIVO,
        activo=True,
    ):
        return Subscription.objects.create(
            organizacion_id=organizacion_id or self.organizacion,
            nombre=nombre,
            monto=Decimal("12990.00"),
            moneda="CLP",
            frecuencia=frecuencia,
            fecha_proximo_cobro=fecha,
            estado=estado,
            activo=activo,
        )

    def get_calendario(self, mes):
        return self.client.get(
            f"/api/suscripciones/calendario-cobros/?mes={mes}",
            headers=self.headers,
        )

    def test_incluye_confirmados_y_proyectados_sin_duplicarlos(self):
        suscripcion = self.crear_suscripcion(fecha=date(2026, 10, 5))
        cobro = Cobro.objects.create(
            organizacion_id=self.organizacion,
            suscripcion=suscripcion,
            monto=Decimal("14990.00"),
            moneda="USD",
            fecha=date(2026, 10, 5),
        )
        otra = self.crear_suscripcion(nombre="Otro", fecha=date(2026, 10, 20))

        response = self.get_calendario("2026-10")

        assert response.status_code == status.HTTP_200_OK
        assert response.data == [
            {
                "id": str(cobro.id),
                "suscripcion_id": str(suscripcion.id),
                "fecha": "2026-10-05",
                "servicio": "Servicio",
                "importe": "14990.00",
                "moneda": "USD",
                "tipo": "confirmado",
            },
            {
                "id": str(otra.id),
                "suscripcion_id": str(otra.id),
                "fecha": "2026-10-20",
                "servicio": "Otro",
                "importe": "12990.00",
                "moneda": "CLP",
                "tipo": "proyectado",
            },
        ]

    def test_cobro_confirmado_omite_proyeccion_del_mismo_mes(self):
        suscripcion = self.crear_suscripcion(fecha=date(2026, 10, 15))
        cobro = Cobro.objects.create(
            organizacion_id=self.organizacion,
            suscripcion=suscripcion,
            monto=suscripcion.monto,
            fecha=date(2026, 10, 14),
        )

        response = self.get_calendario("2026-10")

        assert response.status_code == status.HTTP_200_OK
        assert [(evento["id"], evento["tipo"]) for evento in response.data] == [
            (str(cobro.id), "confirmado")
        ]

    def test_diciembre_enero_y_limites_del_mes(self):
        cierre = self.crear_suscripcion(
            nombre="Cierre", fecha=date(2026, 12, 31)
        )
        apertura = self.crear_suscripcion(
            nombre="Apertura", fecha=date(2027, 1, 1)
        )
        for suscripcion, fecha in (
            (cierre, date(2026, 12, 31)),
            (apertura, date(2027, 1, 1)),
        ):
            Cobro.objects.create(
                organizacion_id=self.organizacion,
                suscripcion=suscripcion,
                monto=suscripcion.monto,
                fecha=fecha,
            )

        diciembre = self.get_calendario("2026-12")
        enero = self.get_calendario("2027-01")

        assert [(evento["servicio"], evento["fecha"]) for evento in diciembre.data] == [
            ("Cierre", "2026-12-31")
        ]
        assert [(evento["servicio"], evento["fecha"]) for evento in enero.data] == [
            ("Apertura", "2027-01-01"),
            ("Cierre", "2027-01-31"),
        ]

    def test_meses_cortos_respetan_dia_ancla_y_anios_bisiestos(self):
        self.crear_suscripcion(nombre="Normal", fecha=date(2025, 1, 31))
        self.crear_suscripcion(nombre="Bisiesto", fecha=date(2024, 1, 31))

        febrero_normal = self.get_calendario("2025-02")
        febrero_bisiesto = self.get_calendario("2024-02")
        marzo = self.get_calendario("2025-03")

        assert {
            evento["servicio"]: evento["fecha"] for evento in febrero_normal.data
        } == {"Normal": "2025-02-28", "Bisiesto": "2025-02-28"}
        assert [evento["fecha"] for evento in febrero_bisiesto.data] == ["2024-02-29"]
        assert {
            evento["servicio"]: evento["fecha"] for evento in marzo.data
        } == {"Normal": "2025-03-31", "Bisiesto": "2025-03-31"}

    def test_la_frecuencia_anual_solo_proyecta_en_su_mes(self):
        self.crear_suscripcion(
            frecuencia=Subscription.Frecuencia.ANUAL,
            fecha=date(2024, 2, 29),
        )

        aniversario = self.get_calendario("2025-02")
        mes_siguiente = self.get_calendario("2025-03")

        assert [evento["fecha"] for evento in aniversario.data] == ["2025-02-28"]
        assert mes_siguiente.data == []

    def test_no_proyecta_cobros_anteriores_a_hoy(self, monkeypatch):
        monkeypatch.setattr(
            "app.views.timezone.localdate", lambda: date(2026, 10, 16)
        )
        self.crear_suscripcion(fecha=date(2026, 8, 15))

        agosto = self.get_calendario("2026-08")
        octubre = self.get_calendario("2026-10")
        noviembre = self.get_calendario("2026-11")

        assert agosto.data == []
        assert octubre.data == []
        assert [evento["fecha"] for evento in noviembre.data] == ["2026-11-15"]

    def test_solo_proyecta_activas_no_canceladas_y_de_su_organizacion(self):
        cancelada = self.crear_suscripcion(
            nombre="Cancelada", estado=Subscription.Estado.CANCELADO
        )
        cobro_cancelada = Cobro.objects.create(
            organizacion_id=self.organizacion,
            suscripcion=cancelada,
            monto=cancelada.monto,
            fecha=date(2026, 10, 15),
        )
        self.crear_suscripcion(nombre="Inactiva", activo=False)
        ajena = self.crear_suscripcion(
            nombre="Ajena", organizacion_id=self.otra_organizacion
        )
        Cobro.objects.create(
            organizacion_id=self.otra_organizacion,
            suscripcion=ajena,
            monto=ajena.monto,
            fecha=date(2026, 10, 15),
        )

        response = self.get_calendario("2026-10")

        assert response.status_code == status.HTTP_200_OK
        assert response.data == [
            {
                "id": str(cobro_cancelada.id),
                "suscripcion_id": str(cancelada.id),
                "fecha": "2026-10-15",
                "servicio": "Cancelada",
                "importe": "12990.00",
                "moneda": "CLP",
                "tipo": "confirmado",
            }
        ]

    @pytest.mark.parametrize("mes", ["", "2026-13", "2026-2", "2026-02-01", "0000-01"])
    def test_rechaza_mes_ausente_o_invalido(self, mes):
        response = self.get_calendario(mes)

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_requiere_contexto_de_organizacion(self):
        response = self.client.get("/api/suscripciones/calendario-cobros/?mes=2026-10")

        assert response.status_code == status.HTTP_403_FORBIDDEN

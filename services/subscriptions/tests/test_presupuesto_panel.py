"""Pruebas de aceptación para:
- VI-05: Definir presupuesto mensual y comparar proyección (RF-13 / RF-19).
- VI-06: Exponer resumen agregado del panel (RF-11 / RF-09).
"""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Cobro, Presupuesto, Subscription


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def org_principal() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def org_ajena() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture(autouse=True)
def fijar_hoy(monkeypatch):
    """Fija 'hoy' a 2026-10-01 para que _calcular_gasto_proyectado no descarte
    fechas pasadas y los tests no dependan del día en que corren (Bloqueante 1).
    """
    monkeypatch.setattr("app.views.timezone.localdate", lambda: date(2026, 10, 1))


def crear_suscripcion(
    org_id: uuid.UUID,
    nombre: str,
    monto: str = "10000.00",
    moneda: str = "CLP",
    estado: str = "activo",
    fecha_cobro: date | None = None,
    frecuencia: str = "mensual",
) -> Subscription:
    if fecha_cobro is None:
        fecha_cobro = date(2026, 10, 20)
    return Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia=frecuencia,
        fecha_proximo_cobro=fecha_cobro,
        estado=estado,
    )


# ══════════════════════════════════════════════════════════════════════
# VI-05: Presupuesto mensual y comparación de proyección
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestPresupuestoMensualVI05:
    """Verifica la persistencia y comparación de presupuesto mensual."""

    def test_crear_y_actualizar_presupuesto(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}

        # Crear
        resp = client.post(
            "/api/suscripciones/presupuesto/",
            {"mes": "2026-10", "monto": "50000.00", "moneda": "CLP"},
            format="json",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["monto"] == "50000.00"
        assert resp.data["mes"] == "2026-10"

        # Actualizar mismo mes y moneda (idempotencia)
        resp2 = client.post(
            "/api/suscripciones/presupuesto/",
            {"mes": "2026-10", "monto": "60000.00", "moneda": "CLP"},
            format="json",
            headers=headers,
        )
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["monto"] == "60000.00"
        assert Presupuesto.objects.filter(organizacion_id=org_principal).count() == 1

    def test_rechaza_monto_cero_o_negativo(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}
        resp = client.post(
            "/api/suscripciones/presupuesto/",
            {"mes": "2026-10", "monto": "0.00", "moneda": "CLP"},
            format="json",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_rechaza_mes_invalido(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}
        resp = client.post(
            "/api/suscripciones/presupuesto/",
            {"mes": "2026-13", "monto": "1000.00", "moneda": "CLP"},
            format="json",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_comparacion_gasto_real_proyeccion_y_diferencia(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}
        # Presupuesto: 50.000 CLP
        Presupuesto.objects.create(
            organizacion_id=org_principal,
            mes="2026-10",
            moneda="CLP",
            monto=Decimal("50000.00"),
        )

        # Suscripción 1: ya tuvo cobro de 15.000 CLP en octubre
        s1 = crear_suscripcion(org_principal, "Streaming", monto="15000.00")
        Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=s1,
            monto=Decimal("15000.00"),
            moneda="CLP",
            fecha=date(2026, 10, 5),
        )

        # Suscripción 2: proyectada para fin de mes (20.000 CLP)
        crear_suscripcion(
            org_principal, "Nube", monto="20000.00", fecha_cobro=date(2026, 10, 28)
        )

        resp = client.get(
            "/api/suscripciones/presupuesto/?mes=2026-10&moneda=CLP",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        data = resp.data
        assert data["presupuesto"] == "50000.00"
        assert Decimal(data["gasto_real"]) == Decimal("15000.00")
        assert Decimal(data["gasto_proyectado"]) == Decimal("20000.00")
        assert Decimal(data["total_esperado"]) == Decimal("35000.00")
        assert Decimal(data["diferencia"]) == Decimal("15000.00")
        assert data["porcentaje_consumido"] == 70.0
        assert data["alerta_superado"] is False
    def test_sin_presupuesto_no_divide_por_cero(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}
        crear_suscripcion(org_principal, "Musica", monto="8000.00")

        resp = client.get(
            "/api/suscripciones/presupuesto/?mes=2026-10&moneda=CLP",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["presupuesto"] is None
        assert resp.data["diferencia"] is None
        assert resp.data["porcentaje_consumido"] == 0.0
        assert resp.data["alerta_superado"] is False

    def test_no_mezcla_clp_y_usd(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}
        # Presupuesto en CLP
        Presupuesto.objects.create(
            organizacion_id=org_principal,
            mes="2026-10",
            moneda="CLP",
            monto=Decimal("10000.00"),
        )
        # Suscripción en USD
        crear_suscripcion(
            org_principal, "USD Service", monto="100.00", moneda="USD"
        )

        resp = client.get(
            "/api/suscripciones/presupuesto/?mes=2026-10&moneda=CLP",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        # El gasto proyectado de USD no se suma al presupuesto CLP
        assert Decimal(resp.data["gasto_proyectado"]) == Decimal("0.00")


# ══════════════════════════════════════════════════════════════════════
# VI-06: Resumen agregado del panel
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestResumenPanelVI06:
    """Verifica el endpoint GET /api/suscripciones/resumen/."""

    def test_resumen_completo_con_gasto_proyeccion_y_conteo(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}

        # Suscripción activa con cobro realizado
        s_activa = crear_suscripcion(
            org_principal, "Activa", monto="10000.00", estado="activo"
        )
        Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=s_activa,
            monto=Decimal("10000.00"),
            moneda="CLP",
            fecha=date(2026, 10, 10),
        )

        # Suscripción activa proyectada sin cobro (cae el 25-10 > 01-10: proyectable)
        crear_suscripcion(
            org_principal, "Proyectada", monto="5000.00", estado="activo", fecha_cobro=date(2026, 10, 25)
        )

        # Suscripción en prueba
        crear_suscripcion(
            org_principal, "Trial", monto="3000.00", estado="prueba",
            fecha_cobro=date(2026, 10, 20),  # 20-10 > 01-10: proyectable pero en prueba
        )

        # Suscripción cancelada (no debe proyectarse en el futuro)
        crear_suscripcion(
            org_principal, "Cancelada", monto="7000.00", estado="cancelado"
        )

        resp = client.get(
            "/api/suscripciones/resumen/?mes=2026-10&moneda=CLP",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        data = resp.data
        assert data["periodo"] == "2026-10"
        assert data["moneda"] == "CLP"
        assert Decimal(data["gasto_real"]) == Decimal("10000.00")
        # Con fijar_hoy=2026-10-01, "Proyectada" (25-10, activo) y "Trial"
        # (20-10, prueba) son proyectables — solo se excluye "cancelado".
        # Total proyectado: 5000 + 3000 = 8000 CLP.
        assert Decimal(data["gasto_proyectado"]) == Decimal("8000.00")
        assert Decimal(data["total_estimado"]) == Decimal(data["gasto_real"]) + Decimal(data["gasto_proyectado"])

        conteo = data["conteo_estados"]
        assert conteo["activo"] == 2
        assert conteo["prueba"] == 1
        assert conteo["cancelado"] == 1
        assert conteo["total"] == 4

    def test_estado_vacio_devuelve_ceros_y_estructura_estable(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        headers = {"X-Organizacion-Id": str(org_principal)}

        resp = client.get(
            "/api/suscripciones/resumen/?mes=2026-10&moneda=CLP",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        data = resp.data
        assert Decimal(data["gasto_real"]) == Decimal("0.00")
        assert Decimal(data["gasto_proyectado"]) == Decimal("0.00")
        assert Decimal(data["total_estimado"]) == Decimal("0.00")

        conteo = data["conteo_estados"]
        assert conteo["activo"] == 0
        assert conteo["prueba"] == 0
        assert conteo["por_confirmar"] == 0
        assert conteo["cancelado"] == 0
        assert conteo["fantasma"] == 0
        assert conteo["total"] == 0

    def test_aislamiento_tenant_en_resumen(
        self, client: APIClient, org_principal: uuid.UUID, org_ajena: uuid.UUID
    ) -> None:
        crear_suscripcion(org_ajena, "Ajena", monto="99999.00")
        headers = {"X-Organizacion-Id": str(org_principal)}

        resp = client.get(
            "/api/suscripciones/resumen/?mes=2026-10&moneda=CLP",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["conteo_estados"]["total"] == 0
        assert Decimal(resp.data["total_estimado"]) == Decimal("0.00")

    def test_suscripcion_eliminada_no_cuenta_en_conteo(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        """Bloqueante 2: una suscripción con soft-delete (activo=False) no debe
        aparecer en conteo_estados. TenantViewSet.get_queryset() no filtra activo=True.
        """
        headers = {"X-Organizacion-Id": str(org_principal)}
        suscripcion = crear_suscripcion(org_principal, "Eliminada", estado="activo")

        # Soft-delete vía API
        del_resp = client.delete(
            f"/api/suscripciones/{suscripcion.id}/",
            headers=headers,
        )
        assert del_resp.status_code == status.HTTP_204_NO_CONTENT

        resp = client.get(
            "/api/suscripciones/resumen/?mes=2026-10&moneda=CLP",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        conteo = resp.data["conteo_estados"]
        assert conteo["activo"] == 0, (
            "Una suscripción eliminada (activo=False) no debe contar en el conteo."
        )
        assert conteo["total"] == 0


@pytest.mark.django_db
class TestPresupuestoSinCabecera:
    """Importante 3: POST /presupuesto/ sin X-Organizacion-Id debe retornar 403."""

    def test_post_presupuesto_sin_organizacion_retorna_403(
        self, client: APIClient
    ) -> None:
        resp = client.post(
            "/api/suscripciones/presupuesto/",
            {"mes": "2026-10", "monto": "50000.00", "moneda": "CLP"},
            format="json",
            # Sin cabecera X-Organizacion-Id
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN, (
            "Sin X-Organizacion-Id debe responder 403, no 500 (IntegrityError)."
        )

"""Pruebas de aceptación para Sub-lote B:
- VI-03: Cancelar suscripción sin hacer soft-delete (RF-10).
- VI-09: Reactivar o confirmar un cobro detectado (RF-03 / máquina de estados).
"""

from datetime import date, timedelta
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Cobro, Subscription, TransicionEstado


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def org_principal() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def org_ajena() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def actor_id() -> uuid.UUID:
    return uuid.uuid4()


def crear_suscripcion(
    org_id: uuid.UUID,
    nombre: str,
    estado: str = Subscription.Estado.ACTIVO,
    monto: str = "9990.00",
) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal(monto),
        moneda="CLP",
        frecuencia="mensual",
        fecha_proximo_cobro=date(2026, 11, 1),
        estado=estado,
    )


# ══════════════════════════════════════════════════════════════════════
# VI-03: Cancelar suscripción sin hacer soft-delete
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestCancelarSuscripcionVI03:
    """Verifica cancelación explícita preservando activo=True e histórico."""

    def test_cancelar_conserva_activo_y_cobros_historicos(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Streaming Pro")
        cobro = Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("9990.00"),
            moneda="CLP",
            fecha=date(2026, 10, 1),
        )

        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }
        resp = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["estado"] == Subscription.Estado.CANCELADO
        assert resp.data["activo"] is True

        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.CANCELADO
        assert suscripcion.activo is True

        # Cobros históricos se conservan intactos
        assert Cobro.objects.filter(suscripcion=suscripcion).count() == 1
        assert Cobro.objects.get(pk=cobro.pk).monto == Decimal("9990.00")

    def test_repetir_cancelacion_es_idempotente(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Suscripcion A")
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }

        # Primera cancelación
        resp1 = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers,
        )
        assert resp1.status_code == status.HTTP_200_OK
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1

        # Segunda cancelación (idempotente)
        resp2 = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers,
        )
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["estado"] == Subscription.Estado.CANCELADO
        # No genera eventos duplicados en auditoría
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1

    def test_cancelacion_via_patch_idempotente(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Suscripcion B")
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "integrante",
        }

        resp1 = client.patch(
            f"/api/suscripciones/{suscripcion.id}/",
            {"estado": "cancelado"},
            format="json",
            headers=headers,
        )
        assert resp1.status_code == status.HTTP_200_OK
        assert resp1.data["estado"] == Subscription.Estado.CANCELADO

        # Repetir PATCH cancelado cuando ya está cancelado
        resp2 = client.patch(
            f"/api/suscripciones/{suscripcion.id}/",
            {"estado": "cancelado"},
            format="json",
            headers=headers,
        )
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["estado"] == Subscription.Estado.CANCELADO
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1

    def test_cancelar_rechaza_rol_no_autorizado(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Suscripcion C")
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "lector",
        }
        resp = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_cancelar_recurso_ajeno_responde_404(
        self, client: APIClient, org_principal: uuid.UUID, org_ajena: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion_ajena = crear_suscripcion(org_ajena, "Ajena")
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }
        resp = client.post(
            f"/api/suscripciones/{suscripcion_ajena.id}/cancelar/",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_404_NOT_FOUND


# ══════════════════════════════════════════════════════════════════════
# VI-09: Reactivar o confirmar un cobro detectado
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestReactivarConfirmarCobroVI09:
    """Verifica reactivación y confirmación de cobros detectados."""

    def test_reactivar_pasa_a_activo_y_audita_una_sola_vez(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(
            org_principal, "Reactivable", estado=Subscription.Estado.CANCELADO
        )
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }

        resp = client.post(
            f"/api/suscripciones/{suscripcion.id}/reactivar/",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["estado"] == Subscription.Estado.ACTIVO

        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO

        auditoria = TransicionEstado.objects.filter(suscripcion=suscripcion)
        assert auditoria.count() == 1
        transicion = auditoria.first()
        assert transicion.evento == Subscription.EventoEstado.COBRO_NUEVO_DETECTADO
        assert transicion.estado_anterior == Subscription.Estado.CANCELADO
        assert transicion.estado_nuevo == Subscription.Estado.ACTIVO

    def test_reactivar_es_idempotente_si_ya_esta_activo(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(
            org_principal, "Ya Activa", estado=Subscription.Estado.ACTIVO
        )
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }

        resp = client.post(
            f"/api/suscripciones/{suscripcion.id}/reactivar/",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["estado"] == Subscription.Estado.ACTIVO
        # No genera filas en auditoría porque no hubo transición real
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 0

    def test_confirmar_o_reactivar_no_crea_cobros_sin_evidencia(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(
            org_principal, "Sin Cobro Espurio", estado=Subscription.Estado.POR_CONFIRMAR
        )
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }

        cobros_antes = Cobro.objects.filter(suscripcion=suscripcion).count()

        resp = client.post(
            f"/api/suscripciones/{suscripcion.id}/transiciones/",
            {"evento": Subscription.EventoEstado.CONFIRMACION_USUARIO},
            format="json",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_200_OK

        cobros_despues = Cobro.objects.filter(suscripcion=suscripcion).count()
        assert cobros_antes == cobros_despues == 0

    def test_transicion_inválida_no_altera_historial_ni_estado(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(
            org_principal, "Activa", estado=Subscription.Estado.ACTIVO
        )
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }

        # CONFIRMACION_USUARIO solo se permite desde POR_CONFIRMAR
        resp = client.post(
            f"/api/suscripciones/{suscripcion.id}/transiciones/",
            {"evento": Subscription.EventoEstado.CONFIRMACION_USUARIO},
            format="json",
            headers=headers,
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 0

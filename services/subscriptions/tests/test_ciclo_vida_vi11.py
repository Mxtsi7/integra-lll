"""Pruebas de aceptación VI-11: ciclo de vida, baja lógica y trazabilidad.

La tarjeta pide demostrar, con pruebas, que:

* las transiciones inválidas no se persisten;
* cancelar no es lo mismo que eliminar: ``estado=cancelado`` conserva
  ``activo=true`` y el histórico de cobros;
* eliminar es lógico (``activo=false``), excluye de listados/detalle/panel y
  conserva los cobros para el calendario;
* reactivar y confirmar una suscripción son transiciones explícitas y
  auditables.
"""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Cobro, OutboxEvento, Subscription, TransicionEstado


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


def crear_suscripcion(
    org_id: uuid.UUID,
    *,
    nombre: str = "Netflix",
    estado: str = Subscription.Estado.ACTIVO,
    fecha_proximo_cobro: date = date(2026, 10, 5),
) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=org_id,
        nombre=nombre,
        monto=Decimal("12990.00"),
        moneda="CLP",
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=fecha_proximo_cobro,
        estado=estado,
    )


def headers(org_id: uuid.UUID, *, rol: str = "titular") -> dict[str, str]:
    return {
        "X-Organizacion-Id": str(org_id),
        "X-Usuario-Id": "42",
        "X-Rol": rol,
    }


@pytest.mark.django_db
class TestTransicionesValidasEInvalidas:
    """La máquina de estados es la única puerta para cambiar ``estado``."""

    def test_transicion_invalida_no_cambia_estado_ni_deja_auditoria(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org, estado=Subscription.Estado.ACTIVO)

        respuesta = client.post(
            f"/api/suscripciones/{suscripcion.id}/transiciones/",
            {"evento": Subscription.EventoEstado.CONFIRMACION_USUARIO},
            format="json",
            headers=headers(org),
        )

        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 0
        assert (
            OutboxEvento.objects.filter(
                datos__suscripcion_id=str(suscripcion.id)
            ).count()
            == 0
        )

    def test_patch_no_puede_cambiar_estado_arbitrario(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)

        respuesta = client.patch(
            f"/api/suscripciones/{suscripcion.id}/",
            {"estado": Subscription.Estado.FANTASMA},
            format="json",
            headers=headers(org),
        )

        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO

    def test_confirmacion_desde_por_confirmar_es_auditada(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(
            org, estado=Subscription.Estado.POR_CONFIRMAR
        )

        respuesta = client.post(
            f"/api/suscripciones/{suscripcion.id}/transiciones/",
            {"evento": Subscription.EventoEstado.CONFIRMACION_USUARIO},
            format="json",
            headers=headers(org),
        )

        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta.data["estado_nuevo"] == Subscription.Estado.ACTIVO

        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO
        transicion = TransicionEstado.objects.get(suscripcion=suscripcion)
        assert transicion.evento == Subscription.EventoEstado.CONFIRMACION_USUARIO
        assert transicion.estado_anterior == Subscription.Estado.POR_CONFIRMAR
        assert transicion.estado_nuevo == Subscription.Estado.ACTIVO


@pytest.mark.django_db
class TestCancelacionSinBajaLogica:
    """Cancelar es un estado de negocio; no borra ni oculta el recurso."""

    def test_cancelar_conserva_activo_y_cobros_y_sigue_visible(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        cobro = Cobro.objects.create(
            organizacion_id=org,
            suscripcion=suscripcion,
            monto=Decimal("12990.00"),
            moneda="CLP",
            fecha=date(2026, 9, 5),
        )

        respuesta = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers(org),
        )

        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta.data["estado"] == Subscription.Estado.CANCELADO
        assert respuesta.data["activo"] is True

        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.CANCELADO
        assert suscripcion.activo is True
        assert Cobro.objects.filter(pk=cobro.pk).exists()

        listado = client.get("/api/suscripciones/", headers=headers(org))
        assert listado.status_code == status.HTTP_200_OK
        assert listado.data["count"] == 1
        assert listado.data["results"][0]["estado"] == Subscription.Estado.CANCELADO

        detalle = client.get(
            f"/api/suscripciones/{suscripcion.id}/", headers=headers(org)
        )
        assert detalle.status_code == status.HTTP_200_OK

        historial = client.get(
            f"/api/suscripciones/{suscripcion.id}/cobros/", headers=headers(org)
        )
        assert historial.status_code == status.HTTP_200_OK
        assert historial.data["count"] == 1

    def test_resumen_cuenta_canceladas_pero_no_eliminadas(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        cancelada = crear_suscripcion(org, nombre="Cancelada")
        crear_suscripcion(org, nombre="Activa")

        client.post(
            f"/api/suscripciones/{cancelada.id}/cancelar/",
            headers=headers(org),
        )

        resumen = client.get(
            "/api/suscripciones/resumen/?mes=2026-10", headers=headers(org)
        )

        assert resumen.status_code == status.HTTP_200_OK
        assert resumen.data["conteo_estados"]["cancelado"] == 1
        assert resumen.data["conteo_estados"]["activo"] == 1
        assert resumen.data["conteo_estados"]["total"] == 2


@pytest.mark.django_db
class TestBajaLogica:
    """``DELETE`` desactiva sin perder la evidencia histórica."""

    def test_delete_excluye_de_listado_detalle_y_panel_pero_conserva_cobro(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        cobro = Cobro.objects.create(
            organizacion_id=org,
            suscripcion=suscripcion,
            monto=Decimal("12990.00"),
            moneda="CLP",
            fecha=date(2026, 10, 5),
        )

        respuesta = client.delete(
            f"/api/suscripciones/{suscripcion.id}/", headers=headers(org)
        )
        assert respuesta.status_code == status.HTTP_204_NO_CONTENT

        suscripcion.refresh_from_db()
        assert suscripcion.activo is False
        assert Cobro.objects.filter(pk=cobro.pk).exists()

        listado = client.get("/api/suscripciones/", headers=headers(org))
        assert listado.data["count"] == 0

        detalle = client.get(
            f"/api/suscripciones/{suscripcion.id}/", headers=headers(org)
        )
        assert detalle.status_code == status.HTTP_404_NOT_FOUND

        resumen = client.get(
            "/api/suscripciones/resumen/?mes=2026-10", headers=headers(org)
        )
        assert resumen.data["conteo_estados"]["total"] == 0
        assert Decimal(resumen.data["gasto_real"]) == Decimal("0.00")

        calendario = client.get(
            "/api/suscripciones/calendario-cobros/?mes=2026-10",
            headers=headers(org),
        )
        assert calendario.status_code == status.HTTP_200_OK
        assert len(calendario.data) == 1
        assert calendario.data[0]["tipo"] == "confirmado"
        assert calendario.data[0]["id"] == str(cobro.id)

    def test_una_suscripcion_eliminada_no_admite_transiciones(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        suscripcion.activo = False
        suscripcion.save(update_fields=("activo", "actualizado_en"))

        respuesta = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers(org),
        )

        assert respuesta.status_code == status.HTTP_404_NOT_FOUND
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 0


@pytest.mark.django_db
class TestReactivacion:
    """Reactivar vuelve a ``activo`` sin duplicar la cancelación."""

    def test_reactivar_conserva_historial_de_cobros(
        self, client: APIClient
    ) -> None:
        org = uuid.uuid4()
        suscripcion = crear_suscripcion(org)
        cobro = Cobro.objects.create(
            organizacion_id=org,
            suscripcion=suscripcion,
            monto=Decimal("12990.00"),
            moneda="CLP",
            fecha=date(2026, 9, 5),
        )

        client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers(org),
        )
        respuesta = client.post(
            f"/api/suscripciones/{suscripcion.id}/reactivar/",
            headers=headers(org),
        )

        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta.data["estado"] == Subscription.Estado.ACTIVO

        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO
        assert suscripcion.activo is True
        assert Cobro.objects.filter(pk=cobro.pk).exists()

        eventos = TransicionEstado.objects.filter(
            suscripcion=suscripcion
        ).order_by("ocurrido_en")
        assert [evento.estado_nuevo for evento in eventos] == [
            Subscription.Estado.CANCELADO,
            Subscription.Estado.ACTIVO,
        ]

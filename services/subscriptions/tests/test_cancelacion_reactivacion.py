"""Pruebas de aceptación y concordancia de identidad, concurrencia y outbox para Sub-lote B:
- VI-03: Cancelar suscripción sin hacer soft-delete (RF-10 / RF-03).
- VI-09: Reactivar o confirmar un cobro detectado (RF-03 / máquina de estados).
- Concordancia con IDs enteros de Auth (usuario_id='42').
- Idempotencia bajo select_for_update e instancias previamente leídas.
- Persistencia de correlación en el outbox según MX-21 v2 / VI-26.
- Pruebas de concurrencia y simulación de Gateway con JWT.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from threading import Barrier
import uuid

from django.db import close_old_connections, connection
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Cobro, OutboxEvento, Subscription, TransicionEstado


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
def actor_id() -> int:
    # Auth utiliza identificadores enteros (AutoField / BigAutoField)
    return 42


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
    """Verifica cancelación explícita preservando activo=True, histórico de cobros y outbox."""

    def test_cancelar_conserva_activo_y_cobros_historicos(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Streaming Pro")
        cobro = Cobro.objects.create(
            organizacion_id=org_principal,
            suscripcion=suscripcion,
            monto=Decimal("9990.00"),
            moneda="CLP",
            fecha=date(2026, 10, 1),
        )
        correlation_id = uuid.uuid4()

        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
            "X-Correlation-ID": str(correlation_id),
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

        # Cobros históricos se conservan intactos (RF-10)
        assert Cobro.objects.filter(suscripcion=suscripcion).count() == 1
        assert Cobro.objects.get(pk=cobro.pk).monto == Decimal("9990.00")

        # Auditoría con ID entero del usuario real de Auth
        auditoria = TransicionEstado.objects.filter(suscripcion=suscripcion)
        assert auditoria.count() == 1
        transicion = auditoria.first()
        assert transicion.actor_id == actor_id
        assert transicion.actor_rol == "titular"
        assert transicion.evento == Subscription.EventoEstado.CANCELACION_USUARIO

        # Outbox de MX-21 v2 conserva la correlación HTTP
        eventos = OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id))
        assert eventos.count() == 1
        evento_outbox = eventos.first()
        assert evento_outbox.evento == "suscripcion.estado_cambiado"
        assert evento_outbox.correlation_id == correlation_id
        assert evento_outbox.datos["estado"] == Subscription.Estado.CANCELADO
        assert evento_outbox.datos["estado_anterior"] == Subscription.Estado.ACTIVO

    def test_repetir_cancelacion_es_idempotente(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
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
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 1

        # Segunda cancelación (idempotente)
        resp2 = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers,
        )
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["estado"] == Subscription.Estado.CANCELADO
        # No genera eventos duplicados en auditoría ni en el outbox
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 1

    def test_cancelar_idempotencia_con_instancias_previamente_leidas(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
    ) -> None:
        """Reproduce el hallazgo [P1]: dos lecturas previas no deben fallar en la segunda cancelación."""
        suscripcion = crear_suscripcion(org_principal, "Instancias Concurrentes Cancelar")
        instancia1 = Subscription.objects.get(pk=suscripcion.pk)
        instancia2 = Subscription.objects.get(pk=suscripcion.pk)
        assert instancia1.estado == Subscription.Estado.ACTIVO
        assert instancia2.estado == Subscription.Estado.ACTIVO

        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }

        resp1 = client.post(f"/api/suscripciones/{instancia1.id}/cancelar/", headers=headers)
        assert resp1.status_code == status.HTTP_200_OK
        assert resp1.data["estado"] == Subscription.Estado.CANCELADO

        # Segunda petición sobre la entidad ya leída previamente cuando estaba ACTIVA
        resp2 = client.post(f"/api/suscripciones/{instancia2.id}/cancelar/", headers=headers)
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["estado"] == Subscription.Estado.CANCELADO

        # Sin auditoría duplicada ni outbox redundante
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 1

    def test_cancelacion_via_patch_idempotente(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
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
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 1

    def test_cancelar_rechaza_actor_id_invalido_o_no_entero(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Suscripcion Actor Invalido")
        # UUID en vez de entero
        headers_uuid = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(uuid.uuid4()),
            "X-Rol": "titular",
        }
        resp = client.post(f"/api/suscripciones/{suscripcion.id}/cancelar/", headers=headers_uuid)
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "actor_id" in resp.data

        # Texto arbitrario
        headers_texto = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": "no_es_entero",
            "X-Rol": "titular",
        }
        resp2 = client.post(f"/api/suscripciones/{suscripcion.id}/cancelar/", headers=headers_texto)
        assert resp2.status_code == status.HTTP_400_BAD_REQUEST

        # No positivo
        headers_cero = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": "0",
            "X-Rol": "titular",
        }
        resp3 = client.post(f"/api/suscripciones/{suscripcion.id}/cancelar/", headers=headers_cero)
        assert resp3.status_code == status.HTTP_400_BAD_REQUEST

    def test_cancelar_sin_actor_id_responde_403(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        suscripcion = crear_suscripcion(org_principal, "Suscripcion Sin Actor")
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Rol": "titular",
        }
        resp = client.post(f"/api/suscripciones/{suscripcion.id}/cancelar/", headers=headers)
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_cancelar_rechaza_rol_no_autorizado(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
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
        self, client: APIClient, org_principal: uuid.UUID, org_ajena: uuid.UUID, actor_id: int
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
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
    ) -> None:
        suscripcion = crear_suscripcion(
            org_principal, "Reactivable", estado=Subscription.Estado.CANCELADO
        )
        correlation_id = uuid.uuid4()
        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
            "X-Correlation-ID": str(correlation_id),
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
        assert transicion.actor_id == actor_id
        assert transicion.evento == Subscription.EventoEstado.REACTIVACION_USUARIO
        assert transicion.estado_anterior == Subscription.Estado.CANCELADO
        assert transicion.estado_nuevo == Subscription.Estado.ACTIVO

        eventos = OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id))
        assert eventos.count() == 1
        assert eventos.first().correlation_id == correlation_id
        assert eventos.first().datos["estado"] == Subscription.Estado.ACTIVO
        assert eventos.first().datos["estado_anterior"] == Subscription.Estado.CANCELADO

    def test_reactivar_es_idempotente_si_ya_esta_activo(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
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
        # No genera filas en auditoría ni outbox porque no hubo transición real
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 0
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 0

    def test_reactivar_idempotencia_con_instancias_previamente_leidas(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
    ) -> None:
        """Reproduce el hallazgo [P1]: no generar doble auditoría cancelado->activo y activo->activo."""
        suscripcion = crear_suscripcion(
            org_principal, "Instancias Reactivar", estado=Subscription.Estado.CANCELADO
        )
        instancia1 = Subscription.objects.get(pk=suscripcion.pk)
        instancia2 = Subscription.objects.get(pk=suscripcion.pk)
        assert instancia1.estado == Subscription.Estado.CANCELADO
        assert instancia2.estado == Subscription.Estado.CANCELADO

        headers = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": str(actor_id),
            "X-Rol": "titular",
        }

        resp1 = client.post(f"/api/suscripciones/{instancia1.id}/reactivar/", headers=headers)
        assert resp1.status_code == status.HTTP_200_OK
        assert resp1.data["estado"] == Subscription.Estado.ACTIVO

        # Segunda petición sobre la instancia leída previamente
        resp2 = client.post(f"/api/suscripciones/{instancia2.id}/reactivar/", headers=headers)
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["estado"] == Subscription.Estado.ACTIVO

        # Exactamente 1 fila en auditoría y 1 en outbox
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 1

    def test_confirmar_o_reactivar_no_crea_cobros_sin_evidencia(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
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

    def test_transicion_invalida_no_altera_historial_ni_outbox_rollback(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
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
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 0

    def test_reactivar_desde_estado_invalido_responde_400(
        self, client: APIClient, org_principal: uuid.UUID, actor_id: int
    ) -> None:
        """VI-09: /reactivar/ solo permite transición desde CANCELADO; desde PRUEBA o FANTASMA responde 400."""
        suscripcion = crear_suscripcion(
            org_principal, "En Prueba", estado=Subscription.Estado.PRUEBA
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
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.PRUEBA
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 0
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 0


# ══════════════════════════════════════════════════════════════════════
# Concurrencia real bajo hilos y PostgreSQL
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db(transaction=True)
class TestConcurrenciaTransiciones:
    """Verifica exclusión mutua e idempotencia concurrente bajo select_for_update."""

    def test_concurrencia_cancelar_simultaneo(
        self, org_principal: uuid.UUID, actor_id: int
    ) -> None:
        if connection.vendor != "postgresql":
            pytest.skip("La concurrencia real entre hilos requiere PostgreSQL")
        suscripcion = crear_suscripcion(org_principal, "Concurrente Cancelar")
        barrera = Barrier(2)

        def ejecutar_cancelacion(correlation):
            close_old_connections()
            try:
                cliente_local = APIClient()
                headers = {
                    "X-Organizacion-Id": str(org_principal),
                    "X-Usuario-Id": str(actor_id),
                    "X-Rol": "titular",
                    "X-Correlation-ID": str(correlation),
                }
                barrera.wait(timeout=10)
                return cliente_local.post(
                    f"/api/suscripciones/{suscripcion.id}/cancelar/",
                    headers=headers,
                )
            finally:
                close_old_connections()

        corr1 = uuid.uuid4()
        corr2 = uuid.uuid4()
        with ThreadPoolExecutor(max_workers=2) as pool:
            respuestas = list(pool.map(ejecutar_cancelacion, [corr1, corr2]))

        # Ambas llamadas reciben 200 OK
        assert all(r.status_code == status.HTTP_200_OK for r in respuestas)
        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.CANCELADO

        # Exactamente 1 transición y 1 outbox registrado
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 1

    def test_concurrencia_reactivar_simultaneo(
        self, org_principal: uuid.UUID, actor_id: int
    ) -> None:
        if connection.vendor != "postgresql":
            pytest.skip("La concurrencia real entre hilos requiere PostgreSQL")
        suscripcion = crear_suscripcion(
            org_principal, "Concurrente Reactivar", estado=Subscription.Estado.CANCELADO
        )
        barrera = Barrier(2)

        def ejecutar_reactivacion(correlation):
            close_old_connections()
            try:
                cliente_local = APIClient()
                headers = {
                    "X-Organizacion-Id": str(org_principal),
                    "X-Usuario-Id": str(actor_id),
                    "X-Rol": "titular",
                    "X-Correlation-ID": str(correlation),
                }
                barrera.wait(timeout=10)
                return cliente_local.post(
                    f"/api/suscripciones/{suscripcion.id}/reactivar/",
                    headers=headers,
                )
            finally:
                close_old_connections()

        corr1 = uuid.uuid4()
        corr2 = uuid.uuid4()
        with ThreadPoolExecutor(max_workers=2) as pool:
            respuestas = list(pool.map(ejecutar_reactivacion, [corr1, corr2]))

        assert all(r.status_code == status.HTTP_200_OK for r in respuestas)
        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.ACTIVO

        # Exactamente 1 auditoría cancelado -> activo y 1 evento outbox
        assert TransicionEstado.objects.filter(suscripcion=suscripcion).count() == 1
        assert OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).count() == 1


# ══════════════════════════════════════════════════════════════════════
# Contrato de cabeceras inyectadas por Gateway con identidad de Auth
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.django_db
class TestContratoCabecerasGateway:
    """Verifica el contrato de cabeceras downstream que el Gateway inyecta tras decodificar el JWT de Auth."""

    def test_flujo_cancelar_y_reactivar_con_cabeceras_inyectadas_por_gateway(
        self, client: APIClient, org_principal: uuid.UUID
    ) -> None:
        # Gateway extrae user_id=42 del JWT y lo inyecta como '42' en X-Usuario-Id
        usuario_auth_id = "42"
        suscripcion = crear_suscripcion(org_principal, "Suscripcion Gateway")
        correlacion_cancelar = uuid.uuid4()

        headers_gateway_cancelar = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": usuario_auth_id,
            "X-Rol": "titular",
            "X-Correlation-ID": str(correlacion_cancelar),
        }

        # 1. Cancelar a través de la interfaz del gateway
        resp_cancel = client.post(
            f"/api/suscripciones/{suscripcion.id}/cancelar/",
            headers=headers_gateway_cancelar,
        )
        assert resp_cancel.status_code == status.HTTP_200_OK
        assert resp_cancel.data["estado"] == Subscription.Estado.CANCELADO

        transicion_cancel = TransicionEstado.objects.get(suscripcion=suscripcion)
        assert transicion_cancel.actor_id == 42
        assert transicion_cancel.actor_rol == "titular"

        outbox_cancel = OutboxEvento.objects.get(datos__suscripcion_id=str(suscripcion.id))
        assert outbox_cancel.correlation_id == correlacion_cancelar
        assert outbox_cancel.datos["estado"] == "cancelado"

        # 2. Reactivar a través del gateway
        correlacion_reactivar = uuid.uuid4()
        headers_gateway_reactivar = {
            "X-Organizacion-Id": str(org_principal),
            "X-Usuario-Id": usuario_auth_id,
            "X-Rol": "titular",
            "X-Correlation-ID": str(correlacion_reactivar),
        }

        resp_react = client.post(
            f"/api/suscripciones/{suscripcion.id}/reactivar/",
            headers=headers_gateway_reactivar,
        )
        assert resp_react.status_code == status.HTTP_200_OK
        assert resp_react.data["estado"] == Subscription.Estado.ACTIVO

        transiciones = TransicionEstado.objects.filter(suscripcion=suscripcion).order_by("ocurrido_en")
        assert transiciones.count() == 2
        transicion_react = transiciones.last()
        assert transicion_react.actor_id == 42
        assert transicion_react.evento == Subscription.EventoEstado.REACTIVACION_USUARIO

        outbox_eventos = OutboxEvento.objects.filter(datos__suscripcion_id=str(suscripcion.id)).order_by("ocurrido_en")
        assert outbox_eventos.count() == 2
        assert outbox_eventos.last().correlation_id == correlacion_reactivar

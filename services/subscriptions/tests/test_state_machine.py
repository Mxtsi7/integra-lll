"""Pruebas de transiciones autorizadas, umbrales y auditoría de RF-03."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from threading import Barrier
from types import SimpleNamespace
import uuid

import pytest
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection
from django.utils import timezone

from app.models import Cobro, Subscription, TransicionEstado
from app.serializers import SubscriptionSerializer
from app.views import SubscriptionViewSet
from rest_framework import status
from rest_framework.test import APIClient


TRANSICIONES_PERMITIDAS = [
    (evento, estado)
    for evento, (estados, _) in Subscription.TRANSICIONES_ESTADO.items()
    for estado in estados
]


@pytest.fixture(params=[
    datetime(2026, 10, 21, 3, 30, tzinfo=UTC),
    datetime(2026, 10, 21, 15, 0, tzinfo=UTC),
], ids=['madrugada_santiago', 'mediodia_santiago'])
def reloj_umbral(request, monkeypatch):
    # La ventana cruza el cambio de hora de septiembre en ambos casos.
    monkeypatch.setattr(timezone, 'now', lambda: request.param)
    with timezone.override('America/Santiago'):
        yield


def fecha_local_hace(dias: int) -> datetime:
    # El dominio cuenta fechas locales, no bloques de 24 horas en UTC.
    fecha = timezone.localdate() - timedelta(days=dias)
    return timezone.make_aware(datetime.combine(fecha, time(12)))


def crear_suscripcion(estado: str) -> Subscription:
    hoy = timezone.localdate()
    suscripcion = Subscription.objects.create(
        organizacion_id=uuid.uuid4(),
        nombre="Servicio de prueba",
        monto=Decimal("4990.00"),
        moneda="CLP",
        frecuencia="mensual",
        fecha_proximo_cobro=hoy + timedelta(days=30),
        estado=estado,
        fin_prueba=hoy - timedelta(days=1)
        if estado == Subscription.Estado.PRUEBA
        else None,
    )
    Subscription.objects.filter(pk=suscripcion.pk).update(
        creado_en=timezone.now() - timedelta(days=100)
    )
    suscripcion.refresh_from_db()
    return suscripcion


def preparar_ventana_gracia(suscripcion: Subscription) -> None:
    transicion = TransicionEstado.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        evento=Subscription.EventoEstado.FALLO_COBRO,
        estado_anterior=Subscription.Estado.ACTIVO,
        estado_nuevo=Subscription.Estado.POR_CONFIRMAR,
        actor_rol="sistema",
    )
    TransicionEstado.objects.filter(pk=transicion.pk).update(
        ocurrido_en=timezone.now() - timedelta(days=31)
    )


def preparar_umbral(suscripcion: Subscription, evento: str) -> None:
    if evento == Subscription.EventoEstado.SIN_RESPUESTA_30_DIAS:
        preparar_ventana_gracia(suscripcion)


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("evento", "estado_inicial"),
    TRANSICIONES_PERMITIDAS,
    ids=lambda value: str(value),
)
def test_transicion_permitida_actualiza_estado_y_audita(
    evento: str, estado_inicial: str
) -> None:
    suscripcion = crear_suscripcion(estado_inicial)
    preparar_umbral(suscripcion, evento)

    transicion = suscripcion.transicionar(
        evento,
        actor_id=uuid.uuid4(),
        actor_rol="sistema",
    )

    estado_destino = Subscription.TRANSICIONES_ESTADO[evento][1]
    suscripcion.refresh_from_db()
    assert suscripcion.estado == estado_destino
    assert suscripcion.activo
    assert transicion.estado_anterior == estado_inicial
    assert transicion.estado_nuevo == estado_destino
    assert transicion.evento == evento
    assert transicion.actor_id is not None


TRANSICIONES_PROHIBIDAS = [
    (evento, estado)
    for evento, (estados, _) in Subscription.TRANSICIONES_ESTADO.items()
    for estado in Subscription.Estado.values
    if estado not in estados
]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("evento", "estado_inicial"),
    TRANSICIONES_PROHIBIDAS,
    ids=lambda value: str(value),
)
def test_transicion_prohibida_no_cambia_estado_ni_crea_auditoria(
    evento: str, estado_inicial: str
) -> None:
    suscripcion = crear_suscripcion(estado_inicial)

    with pytest.raises(ValidationError, match="no está permitido"):
        suscripcion.transicionar(evento)

    suscripcion.refresh_from_db()
    assert suscripcion.estado == estado_inicial
    assert not TransicionEstado.objects.filter(suscripcion=suscripcion).exists()


@pytest.mark.django_db
def test_suscripcion_desactivada_no_puede_transicionar() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    suscripcion.activo = False
    suscripcion.save(update_fields=["activo"])

    with pytest.raises(ValidationError, match="desactivada"):
        suscripcion.transicionar(Subscription.EventoEstado.CANCELACION_USUARIO)

    suscripcion.refresh_from_db()
    assert not suscripcion.activo
    assert suscripcion.estado == Subscription.Estado.ACTIVO
    assert not TransicionEstado.objects.filter(suscripcion=suscripcion).exists()


@pytest.mark.django_db
def test_fin_prueba_no_puede_transicionar_antes_de_la_fecha() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.PRUEBA)
    suscripcion.fin_prueba = timezone.localdate() + timedelta(days=1)
    suscripcion.save(update_fields=["fin_prueba"])

    with pytest.raises(ValidationError, match="fin_prueba"):
        suscripcion.transicionar(Subscription.EventoEstado.FIN_PRUEBA)

    assert suscripcion.transiciones_estado.count() == 0


@pytest.mark.django_db
def test_sin_cobros_requiere_60_dias_completos(reloj_umbral) -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    fecha_creacion = fecha_local_hace(59)
    Subscription.objects.filter(pk=suscripcion.pk).update(creado_en=fecha_creacion)
    suscripcion.refresh_from_db()

    with pytest.raises(ValidationError, match="60 días"):
        suscripcion.transicionar(Subscription.EventoEstado.SIN_COBROS_60_DIAS)

    Subscription.objects.filter(pk=suscripcion.pk).update(
        creado_en=fecha_local_hace(60)
    )
    suscripcion.refresh_from_db()
    suscripcion.transicionar(Subscription.EventoEstado.SIN_COBROS_60_DIAS)
    suscripcion.refresh_from_db()
    assert suscripcion.estado == Subscription.Estado.POR_CONFIRMAR


@pytest.mark.django_db
@pytest.mark.parametrize("dias_sin_uso", [45, 46])
def test_fantasma_requiere_mas_de_45_dias_sin_uso(dias_sin_uso: int, reloj_umbral) -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    Subscription.objects.filter(pk=suscripcion.pk).update(
        creado_en=fecha_local_hace(dias_sin_uso)
    )
    suscripcion.refresh_from_db()

    if dias_sin_uso == 45:
        with pytest.raises(ValidationError, match="más de 45 días"):
            suscripcion.transicionar(Subscription.EventoEstado.SIN_USO_45_DIAS)
        assert suscripcion.transiciones_estado.count() == 0
    else:
        suscripcion.transicionar(Subscription.EventoEstado.SIN_USO_45_DIAS)
        suscripcion.refresh_from_db()
        assert suscripcion.estado == Subscription.Estado.FANTASMA


@pytest.mark.django_db
def test_patch_obsoleto_conserva_transicion_y_campos_de_uso_concurrentes() -> None:
    original = crear_suscripcion(Subscription.Estado.ACTIVO)
    instancia_obsoleta = Subscription.objects.get(pk=original.pk)
    serializer = SubscriptionSerializer(
        instance=instancia_obsoleta,
        data={"nombre": "Servicio actualizado"},
        partial=True,
    )
    assert serializer.is_valid()

    instancia_uso = Subscription.objects.get(pk=original.pk)
    instancia_uso.registrar_uso(60)
    instancia_transicion = Subscription.objects.get(pk=original.pk)
    instancia_transicion.transicionar(
        Subscription.EventoEstado.CANCELACION_USUARIO,
        actor_id=uuid.uuid4(),
        actor_rol="titular",
    )

    view = SubscriptionViewSet()
    view.request = SimpleNamespace(rol=None, usuario_id=None)
    view.perform_update(serializer)

    actualizada = Subscription.objects.get(pk=original.pk)
    assert actualizada.nombre == "Servicio actualizado"
    assert actualizada.estado == Subscription.Estado.CANCELADO
    assert actualizada.horas_uso_mes == Decimal("1.00")
    assert actualizada.ultima_actividad is not None
    assert actualizada.transiciones_estado.count() == 1
    assert (
        actualizada.transiciones_estado.get().evento
        == Subscription.EventoEstado.CANCELACION_USUARIO
    )


@pytest.mark.django_db
def test_cancelacion_deja_activa_la_fila_y_separa_soft_delete() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)

    suscripcion.transicionar(Subscription.EventoEstado.CANCELACION_USUARIO)

    suscripcion.refresh_from_db()
    assert suscripcion.estado == Subscription.Estado.CANCELADO
    assert suscripcion.activo


@pytest.mark.django_db
def test_registro_de_uso_no_sobrescribe_estado_cambiado_tras_cargar_instancia() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    Subscription.objects.filter(pk=suscripcion.pk).update(
        estado=Subscription.Estado.POR_CONFIRMAR
    )

    suscripcion.registrar_uso(30)

    suscripcion.refresh_from_db()
    assert suscripcion.estado == Subscription.Estado.POR_CONFIRMAR
    assert suscripcion.horas_uso_mes == Decimal("0.50")


@pytest.mark.django_db(transaction=True)
def test_registros_de_uso_concurrentes_conservan_el_agregado_mensual() -> None:
    if not connection.features.has_select_for_update:
        pytest.skip("La base de datos no soporta bloqueos de fila.")

    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    inicio = Barrier(2)

    def registrar_en_paralelo() -> None:
        close_old_connections()
        try:
            instancia = Subscription.objects.get(pk=suscripcion.pk)
            inicio.wait(timeout=5)
            instancia.registrar_uso(30)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        tareas = [executor.submit(registrar_en_paralelo) for _ in range(2)]
        for tarea in tareas:
            tarea.result(timeout=15)

    suscripcion.refresh_from_db()
    assert suscripcion.usos.count() == 2
    assert suscripcion.horas_uso_mes == Decimal("1.00")


@pytest.mark.django_db
def test_serializer_patch_no_revert_e_transicion_concurrente() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    serializador = SubscriptionSerializer(instance=suscripcion)

    suscripcion.transicionar(
        Subscription.EventoEstado.CANCELACION_USUARIO,
        actor_id=uuid.uuid4(),
        actor_rol="titular",
    )
    suscripcion.refresh_from_db()

    datos = {"nombre": "Netflix Premium"}
    actualizados = serializador.update(suscripcion, datos)

    assert actualizados.nombre == "Netflix Premium"
    assert actualizados.estado == Subscription.Estado.CANCELADO
    assert actualizados.transiciones_estado.count() == 1
    assert actualizados.transiciones_estado.first().evento == Subscription.EventoEstado.CANCELACION_USUARIO


@pytest.mark.django_db
def test_fin_gracia_requiere_30_dias_en_estado_y_90_sin_cobros() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.POR_CONFIRMAR)
    preparar_ventana_gracia(suscripcion)
    cobro = Cobro.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        monto=suscripcion.monto,
        moneda=suscripcion.moneda,
        fecha=timezone.localdate() - timedelta(days=89),
    )

    with pytest.raises(ValidationError, match="90 días"):
        suscripcion.transicionar(Subscription.EventoEstado.SIN_RESPUESTA_30_DIAS)

    Cobro.objects.filter(pk=cobro.pk).update(
        fecha=timezone.localdate() - timedelta(days=90)
    )
    suscripcion.transicionar(Subscription.EventoEstado.SIN_RESPUESTA_30_DIAS)
    suscripcion.refresh_from_db()
    assert suscripcion.estado == Subscription.Estado.CANCELADO


@pytest.mark.django_db
def test_api_confirma_vigencia_y_expone_auditoria() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.POR_CONFIRMAR)
    actor_id = uuid.uuid4()
    client = APIClient()
    headers = {
        "X-Organizacion-Id": str(suscripcion.organizacion_id),
        "X-Usuario-Id": str(actor_id),
        "X-Rol": "titular",
    }

    response = client.post(
        f"/api/suscripciones/{suscripcion.id}/transiciones/",
        {"evento": Subscription.EventoEstado.CONFIRMACION_USUARIO},
        format="json",
        headers=headers,
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["estado_anterior"] == Subscription.Estado.POR_CONFIRMAR
    assert response.data["estado_nuevo"] == Subscription.Estado.ACTIVO
    assert str(response.data["actor_id"]) == str(actor_id)

    historial = client.get(
        f"/api/suscripciones/{suscripcion.id}/transiciones/",
        headers={"X-Organizacion-Id": str(suscripcion.organizacion_id)},
    )
    assert historial.status_code == status.HTTP_200_OK
    assert len(historial.data) == 1
    assert historial.data[0]["evento"] == Subscription.EventoEstado.CONFIRMACION_USUARIO


@pytest.mark.django_db
def test_api_rechaza_evento_manual_sin_actor() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.POR_CONFIRMAR)
    client = APIClient()

    response = client.post(
        f"/api/suscripciones/{suscripcion.id}/transiciones/",
        {"evento": Subscription.EventoEstado.CONFIRMACION_USUARIO},
        format="json",
        headers={"X-Organizacion-Id": str(suscripcion.organizacion_id)},
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    suscripcion.refresh_from_db()
    assert suscripcion.estado == Subscription.Estado.POR_CONFIRMAR
    assert not TransicionEstado.objects.filter(suscripcion=suscripcion).exists()


@pytest.mark.django_db
def test_api_rechaza_cambio_directo_a_un_estado_no_autorizado() -> None:
    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    client = APIClient()

    response = client.patch(
        f"/api/suscripciones/{suscripcion.id}/",
        {"estado": Subscription.Estado.FANTASMA},
        format="json",
        headers={"X-Organizacion-Id": str(suscripcion.organizacion_id)},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    suscripcion.refresh_from_db()
    assert suscripcion.estado == Subscription.Estado.ACTIVO
    assert not TransicionEstado.objects.filter(suscripcion=suscripcion).exists()


# ── Nuevas pruebas requeridas por PR #67 / VI-10 ───────────────────────────

@pytest.mark.django_db
def test_horas_uso_mes_no_cruza_cambio_de_mes() -> None:
    """El agregado mensual no incluye registros de meses anteriores.

    El campo horas_uso_mes debe reflejar solo el mes local actual.
    Un uso registrado en el mes anterior no debe sumarse al total.
    """
    from app.models import RegistroUso

    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)
    hoy = timezone.localdate()

    # Crear un registro en el mes anterior directamente en BD (sin pasar
    # por registrar_uso para no alterar el estado).
    if hoy.month == 1:
        mes_anterior = hoy.replace(year=hoy.year - 1, month=12, day=1)
    else:
        mes_anterior = hoy.replace(month=hoy.month - 1, day=1)

    RegistroUso.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        fecha=mes_anterior,
        minutos=120,  # 2 horas del mes pasado
    )

    # Registrar 30 minutos en el mes actual
    suscripcion.registrar_uso(30)
    suscripcion.refresh_from_db()

    # Solo los 30 min del mes actual deben reflejarse
    assert suscripcion.horas_uso_mes == Decimal("0.50"), (
        "El agregado mensual no debe incluir registros de meses anteriores."
    )
    assert suscripcion.usos.count() == 2


@pytest.mark.django_db
def test_serializer_horas_uso_mes_se_recalcula_al_cambiar_de_mes(monkeypatch) -> None:
    """El serializer recalcula horas_uso_mes desde el histórico del mes local.

    Si se registra uso el 31-10 y se lee el 1-11, horas_uso_mes debe dar 0.00
    porque el mes cambió y no hay registros en noviembre (VI-10 punto 3).
    """
    from app.serializers import SubscriptionSerializer

    suscripcion = crear_suscripcion(Subscription.Estado.ACTIVO)

    # Registrar uso el 31 de octubre (con fecha explícita)
    suscripcion.registrar_uso(60, fecha=date(2026, 10, 31))
    suscripcion.refresh_from_db()
    # El campo guardado muestra el uso
    assert suscripcion.horas_uso_mes == Decimal("1.00")

    # Simular que es 1 de noviembre: el serializer debe recalcular a 0
    monkeypatch.setattr(
        "app.serializers.timezone.localdate",
        lambda: date(2026, 11, 1),
    )
    datos = SubscriptionSerializer(suscripcion).data
    assert Decimal(datos["horas_uso_mes"]) == Decimal("0.00"), (
        "Al cambiar de mes, horas_uso_mes debe reiniciarse a 0."
    )


@pytest.mark.django_db(transaction=True)
def test_registro_de_uso_concurrente_en_fantasma_no_duplica_transicion() -> None:
    """Dos escrituras concurrentes de uso en una suscripción FANTASMA no
    deben crear dos transiciones USO_REGISTRADO ni dejar el estado inconsistente.

    El select_for_update garantiza que solo un hilo ejecuta la transición;
    el segundo ya la encuentra en ACTIVO y solo añade el uso.
    """
    if not connection.features.has_select_for_update:
        pytest.skip("La base de datos no soporta bloqueos de fila.")

    suscripcion = crear_suscripcion(Subscription.Estado.FANTASMA)
    inicio = Barrier(2)

    def registrar_en_paralelo() -> None:
        close_old_connections()
        try:
            instancia = Subscription.objects.get(pk=suscripcion.pk)
            inicio.wait(timeout=5)
            instancia.registrar_uso(30)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        tareas = [executor.submit(registrar_en_paralelo) for _ in range(2)]
        for tarea in tareas:
            tarea.result(timeout=15)

    suscripcion.refresh_from_db()
    assert suscripcion.estado == Subscription.Estado.ACTIVO
    assert suscripcion.usos.count() == 2
    assert suscripcion.horas_uso_mes == Decimal("1.00")
    # Solo debe haber una transición USO_REGISTRADO
    assert (
        suscripcion.transiciones_estado.filter(
            evento=Subscription.EventoEstado.USO_REGISTRADO
        ).count()
        == 1
    ), "La transición FANTASMA→ACTIVO no debe duplicarse bajo concurrencia."

"""Persistencia del outbox y snapshots de suscripción según MX-21 v2."""

import uuid

from django.utils import timezone

from app.models import OutboxEvento, Subscription


def _correlation_id(value) -> uuid.UUID:
    if value is None:
        return uuid.uuid4()
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


def _snapshot(suscripcion: Subscription) -> dict:
    return {
        "suscripcion_id": str(suscripcion.id),
        "proveedor_id": str(suscripcion.proveedor_id) if suscripcion.proveedor_id else None,
        "nombre": suscripcion.nombre,
        "monto": f"{suscripcion.monto:.2f}",
        "moneda": suscripcion.moneda,
        "ciclo": suscripcion.frecuencia,
        "proximo_cobro": suscripcion.fecha_proximo_cobro.isoformat(),
        "estado": suscripcion.estado,
    }


def _registrar(
    suscripcion: Subscription,
    evento: str,
    datos: dict,
    correlation_id=None,
) -> OutboxEvento:
    return OutboxEvento.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        evento=evento,
        version=2,
        ocurrido_en=timezone.now(),
        correlation_id=_correlation_id(correlation_id),
        datos=datos,
    )


def registrar_creada(
    suscripcion: Subscription, correlation_id=None
) -> OutboxEvento:
    return _registrar(
        suscripcion,
        "suscripcion.creada",
        _snapshot(suscripcion),
        correlation_id,
    )


def registrar_actualizada(
    suscripcion: Subscription,
    campos_modificados: list[str],
    correlation_id=None,
) -> OutboxEvento:
    datos = _snapshot(suscripcion)
    datos["campos_modificados"] = sorted(set(campos_modificados))
    return _registrar(
        suscripcion,
        "suscripcion.actualizada",
        datos,
        correlation_id,
    )


def registrar_estado_cambiado(
    suscripcion: Subscription,
    *,
    estado_anterior: str,
    evento_estado: str,
    correlation_id=None,
) -> OutboxEvento:
    datos = _snapshot(suscripcion)
    datos["estado_anterior"] = estado_anterior
    datos["evento_estado"] = evento_estado
    return _registrar(
        suscripcion,
        "suscripcion.estado_cambiado",
        datos,
        correlation_id,
    )

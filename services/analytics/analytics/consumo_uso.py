"""Traducción de eventos a la proyección de uso (FE-28).

Esto es el adaptador: toma un sobre del catálogo y llama a `uso.py`. Está
separado del consumidor de RabbitMQ a propósito, porque así se puede probar
el comportamiento completo sin levantar un broker — que es lo que hacen las
pruebas de `tests/test_uso.py` y `tests/test_consumo_uso.py`.

── Qué eventos escucha ──────────────────────────────────────────────────────
Los dos que el catálogo dice que escucha analytics y que esto necesita:

    suscripcion.creada   (publica subscriptions)  → deja constancia de que la
                         suscripción existe y desde cuándo. Sin esto no se
                         puede distinguir "no se usa" de "no sabemos".
    uso.registrado       (publica connectors)     → el uso en sí.

── Por qué un sobre inválido se descarta y no se reintenta ──────────────────
Un evento al que le falta `organizacion_id` o que trae una fecha imposible no
se va a arreglar solo: reintentarlo es ocupar la cola para siempre con algo
que nunca va a entrar. Se registra y se descarta. Lo que sí se reintenta es
un fallo de base de datos, que es transitorio.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid

from django.db import transaction

from shared.borrado.bloqueo import bloquear_organizacion

from analytics.uso import primer_dia, proyectar_uso, registrar_suscripcion


log = logging.getLogger(__name__)

EVENTO_SUSCRIPCION_CREADA = "suscripcion.creada"
EVENTO_USO_REGISTRADO = "uso.registrado"
EVENTOS_QUE_ESCUCHA = (EVENTO_SUSCRIPCION_CREADA, EVENTO_USO_REGISTRADO)


class SobreInvalido(ValueError):
    """El evento no cumple el formato común del catálogo."""


def _uuid(valor, campo: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(valor))
    except (ValueError, TypeError, AttributeError):
        raise SobreInvalido(f"`{campo}` no es un UUID: {valor!r}") from None


def _fecha(valor, campo: str) -> dt.date:
    """Acepta una fecha ISO o un instante ISO, y se queda con el día.

    `ocurrido_en` viene con hora y zona (termina en Z); `datos.fecha` viene sin
    hora. Los dos tienen que poder leerse.
    """
    texto = str(valor or "")
    if texto.endswith("Z"):
        texto = texto[:-1] + "+00:00"
    try:
        if "T" in texto:
            return dt.datetime.fromisoformat(texto).date()
        return dt.date.fromisoformat(texto)
    except ValueError:
        raise SobreInvalido(f"`{campo}` no es una fecha ISO: {valor!r}") from None


def aplicar(sobre: dict) -> bool:
    """Aplica un evento a la proyección. True si cambió algo.

    False significa una de dos cosas, y las dos son normales: el evento no es
    de los que escuchamos, o ya se había aplicado (reproceso).
    """
    if not isinstance(sobre, dict):
        raise SobreInvalido("El sobre no es un objeto JSON.")

    nombre = sobre.get("evento")
    if nombre not in EVENTOS_QUE_ESCUCHA:
        return False

    # Obligatorio por la regla 4 del catálogo: el contexto multi-tenant viaja
    # en el evento. Sin esto no se sabe a quién pertenece el uso, y meterlo en
    # la organización equivocada es peor que descartarlo.
    organizacion_id = _uuid(sobre.get("organizacion_id"), "organizacion_id")
    # Serializa toda la proyección con el borrado, incluidos eventos tardíos.
    with transaction.atomic():
        if bloquear_organizacion(organizacion_id, compartido=True).eliminada:
            return False
        return _aplicar_vigente(sobre, nombre, organizacion_id)


def _aplicar_vigente(sobre, nombre, organizacion_id):
    datos = sobre.get("datos") or {}
    if not isinstance(datos, dict):
        raise SobreInvalido("`datos` no es un objeto.")
    suscripcion_id = _uuid(datos.get("suscripcion_id"), "datos.suscripcion_id")

    if nombre == EVENTO_SUSCRIPCION_CREADA:
        # La fecha del HECHO, no la de hoy: si se reprocesan los eventos
        # tiene que dar lo mismo, y es lo que FE-29 necesita para saber desde
        # cuándo se observa.
        registrar_suscripcion(
            organizacion_id=organizacion_id,
            suscripcion_id=suscripcion_id,
            observada_desde=_fecha(sobre.get("ocurrido_en"), "ocurrido_en"),
            nombre=str(datos.get("nombre") or "")[:120],
        )
        return True

    # uso.registrado
    minutos = datos.get("minutos")
    if not isinstance(minutos, int) or isinstance(minutos, bool) or minutos < 0:
        # bool es subclase de int en Python: `True` pasaría como 1 minuto.
        raise SobreInvalido(f"`datos.minutos` no es un entero >= 0: {minutos!r}")

    nuevo = proyectar_uso(
        organizacion_id=organizacion_id,
        suscripcion_id=suscripcion_id,
        evento_id=_uuid(sobre.get("id"), "id"),
        fecha=_fecha(datos.get("fecha"), "datos.fecha"),
        minutos=minutos,
    )
    if not nuevo:
        log.info(
            "uso.registrado %s ya estaba aplicado; no se suma de nuevo", sobre.get("id")
        )
    return nuevo


def mes_del_evento(sobre: dict) -> dt.date:
    """El mes al que pertenece el uso del evento. Para pruebas y diagnóstico."""
    return primer_dia(_fecha((sobre.get("datos") or {}).get("fecha"), "datos.fecha"))

"""Marca un candidato como aplicado cuando llega el acuse de Suscripciones.

`candidato.aplicado` NO es una orden: es la afirmación de que la orden de ida
ya se cumplió. Por eso este módulo no crea suscripciones ni cobros (viven en
otro servicio, ADR-002): solo escribe `CobroCandidato.aplicado_en` con la
fecha que viene en el sobre, que nació de la misma transacción que creó el
cobro.

La idempotencia es condicional, no de memoria: el `UPDATE` exige
`aplicado_en IS NULL`. Una reentrega llega, ve la fecha puesta y confirma sin
moverla. Si el sobre no cumple el contrato, se aparta —reintentarlo no lo
arregla—; si la base está caída, se reintenta antes de apartarlo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import logging
import time
import uuid

from django.db import transaction
from django.db.utils import InterfaceError, OperationalError

from connectors.models import CobroCandidato
from events import validacion
from events.contrato import EVENTO_APLICADO, VERSION_APLICADO
from events.db import close_old_connections

registro = logging.getLogger(__name__)

INTENTOS = 3
ESPERA_INICIAL = 1
ERRORES_PASAJEROS = (OperationalError, InterfaceError)


class AplicacionInvalida(ValueError):
    """El sobre no sirve; reintentarlo no lo arregla."""


@dataclass(frozen=True)
class Resultado:
    """Qué hacer con la entrega y qué efecto tuvo."""

    confirmar: bool
    motivo: str = ""
    marcada: bool = False
    omitida: bool = False


def leer_aplicacion(cuerpo: bytes) -> tuple[dict, dict]:
    """Valida el sobre completo y normaliza los valores que se van a usar."""
    try:
        sobre = json.loads(cuerpo)
    except (TypeError, ValueError) as exc:
        raise AplicacionInvalida(f"no es JSON: {exc}") from exc

    fallos = validacion.errores(sobre)
    if fallos:
        raise AplicacionInvalida(
            "no cumple el contrato candidato.aplicado v1 — " + "; ".join(fallos[:5])
        )
    if (sobre.get("evento"), sobre.get("version")) != (EVENTO_APLICADO, VERSION_APLICADO):
        raise AplicacionInvalida(
            f"evento no admitido en esta cola: {sobre.get('evento')!r} "
            f"v{sobre.get('version')!r}"
        )

    datos = dict(sobre["datos"])
    try:
        datos["candidato_id"] = uuid.UUID(str(datos["candidato_id"]))
        datos["suscripcion_id"] = uuid.UUID(str(datos["suscripcion_id"]))
        if datos["cobro_id"] is not None:
            datos["cobro_id"] = uuid.UUID(str(datos["cobro_id"]))
        datos["aplicada_en"] = datetime.fromisoformat(
            str(datos["aplicada_en"]).replace("Z", "+00:00")
        )
    except (ValueError, TypeError) as exc:
        raise AplicacionInvalida(f"datos del sobre inválidos: {exc}") from exc
    if datos["aplicada_en"].tzinfo is None:
        raise AplicacionInvalida("aplicada_en sin zona horaria")
    return sobre, datos


def _marcar(sobre: dict, datos: dict) -> Resultado:
    """Escribe la fecha una vez, dentro de una transacción."""
    evento_id = str(sobre["id"])
    organizacion_id = uuid.UUID(str(sobre["organizacion_id"]))
    candidato_id = datos["candidato_id"]

    with transaction.atomic():
        # El WHERE hace la idempotencia: dos entregas simultáneas compiten por
        # la misma fila y solo la primera escribe. La fecha es la del acuse,
        # no la de este proceso (que podría reintentar minutos después).
        cambiadas = CobroCandidato.objects.filter(
            pk=candidato_id,
            organizacion_id=organizacion_id,
            estado=CobroCandidato.Estado.CONFIRMADO,
            aplicado_en__isnull=True,
        ).update(
            aplicado_en=datos["aplicada_en"],
            actualizado_en=datos["aplicada_en"],
        )
        if cambiadas:
            registro.info(
                "aplicacion.marcada evento=%s candidato=%s organizacion=%s "
                "suscripcion=%s cobro=%s",
                evento_id, candidato_id, organizacion_id,
                datos["suscripcion_id"], datos["cobro_id"],
            )
            return Resultado(confirmar=True, marcada=True)

        candidato = CobroCandidato.objects.filter(pk=candidato_id).first()
        if candidato is None or candidato.organizacion_id != organizacion_id:
            # No hay fila que marcar y reintentar no la va a crear. Se aparta
            # con rastro, nunca en silencio.
            registro.info(
                "aplicacion.omitida evento=%s candidato=%s fuente=%s "
                "motivo=candidato_inexistente",
                evento_id, candidato_id, EVENTO_APLICADO,
            )
            return Resultado(
                confirmar=True, motivo="candidato_inexistente", omitida=True
            )
        if candidato.aplicado_en is not None:
            return Resultado(confirmar=True, motivo="ya_aplicada", omitida=True)
        return Resultado(
            confirmar=False,
            motivo=f"candidato_en_estado_{candidato.estado}",
        )


def procesar_aplicacion(
    cuerpo: bytes, *, dormir=time.sleep, avisar=None
) -> Resultado:
    """Hace el trabajo de un mensaje y dice si se confirma o se aparta."""
    avisar = avisar or (lambda _texto: None)
    try:
        sobre, datos = leer_aplicacion(cuerpo)
    except AplicacionInvalida as error:
        return Resultado(confirmar=False, motivo=str(error))

    ultimo = None
    espera = ESPERA_INICIAL
    for intento in range(1, INTENTOS + 1):
        try:
            return _marcar(sobre, datos)
        except ERRORES_PASAJEROS as error:
            ultimo = error
            if intento < INTENTOS:
                avisar(
                    f"base no disponible (intento {intento}/{INTENTOS}), "
                    f"reintento en {espera}s: {error}"
                )
                dormir(espera)
                espera *= 2
                close_old_connections()
                continue
        except Exception as error:  # noqa: BLE001
            return Resultado(confirmar=False, motivo=f"error al marcar: {error}")

    return Resultado(
        confirmar=False,
        motivo=f"base no disponible tras {INTENTOS} intentos: {ultimo}",
    )

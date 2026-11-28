"""Aplica un `candidato.confirmado` v1 a Suscripciones.

── Qué hace ────────────────────────────────────────────────────────────────
Un candidato confirmado es una ORDEN, no un dato ya aplicado. Esta capa la
convierte, en una sola transacción, en:

  · una `Subscription` nueva, o la existente del mismo servicio;
  · un `Cobro` SOLO si `datos.crear_cobro` viene en `true`;
  · los eventos MX-21 v2 que correspondan (`suscripcion.creada`, y siempre
    `suscripcion.actualizada` cuando se crea un `Cobro`);
  · la evidencia `TrabajoDerivado(candidato_aplicado)` que hace idempotente la
    reentrega.

`crear_cobro` viaja resuelto desde connectors. Este módulo NUNCA lo deduce del
`tipo_mensaje`: si las dos reglas se separan, gana la que mandó el productor.
El tipo solo gobierna la fecha del próximo cobro.

── Por qué el lock es por (organización, servicio) ─────────────────────────
Un `FOR UPDATE` sobre `EstadoOrganizacion` serializaría TODAS las escrituras
HTTP del tenant: esas peticiones toman `FOR SHARE` sobre la misma fila y
quedarían esperando a que termine una confirmación de cualquier servicio.
Acá se toma un advisory lock por `(organización, servicio normalizado)`, así
que dos confirmaciones de Netflix y Spotify del mismo tenant no se estorban.
La fila de organización se lee con `FOR SHARE` (compartido) solo para detectar
un borrado: compatible con las escrituras HTTP, incompatible con la limpieza.

── SUPUESTOS explicitados ──────────────────────────────────────────────────
* `frecuencia="mensual"` y `categoria="otro"` al crear una suscripción. El
  sobre no trae ciclo ni categoría y el modelo los exige; `mensual` es el
  default del catálogo de MX-21 y `otro` el default del modelo.
* `campos_modificados=["proximo_cobro"]` cuando se crea un `Cobro` aunque no
  cambiara la fecha. El esquema v2 exige un array no vacío de su enum y no
  admite un campo `cobro`; se informa el efecto visible en la suscripción.
* `fecha + 1 mes` para `cobro_realizado`, con el día recortado al último del
  mes destino (31 de enero → 28 de febrero). Nunca se usa la fecha de pago.
* Una suscripción NUEVA con `pago_fallido` usa `fecha` como semilla de su
  `fecha_proximo_cobro` (el campo es obligatorio); para una suscripción
  existente ese tipo no la toca.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
import json
from decimal import Decimal, InvalidOperation
import logging
import re
import time
import unicodedata
import uuid

from django.conf import settings
from django.db import IntegrityError, close_old_connections, transaction
from django.db.utils import InterfaceError, OperationalError

from shared.bloqueo import bloquear
from shared.borrado.bloqueo import bloquear_organizacion

from app.models import Cobro, Subscription, TrabajoDerivado
from events.outbox import registrar_actualizada, registrar_creada
from events.trabajo import HECHO_POR_CONSUMIDOR
from events.validacion import errores as errores_de_contrato

registro = logging.getLogger(__name__)

EVENTO = "candidato.confirmado"
VERSION = 1
TRABAJO = TrabajoDerivado.Trabajo.CANDIDATO_APLICADO

FUENTES_POR_DEFECTO = ("csv", "correo")

# Igual que en el consumidor v2: por debajo del heartbeat de AMQP (60 s).
INTENTOS = 3
ESPERA_INICIAL = 1
ERRORES_PASAJEROS = (OperationalError, InterfaceError)


class ConfirmacionInvalida(ValueError):
    """El sobre no sirve; reintentarlo no lo arregla."""


@dataclass(frozen=True)
class Resultado:
    """Qué hacer con la entrega y qué efecto tuvo."""

    confirmar: bool
    motivo: str = ""
    aplicada: bool = False
    creada: bool = False
    cobro_creado: bool = False
    actualizada: bool = False
    omitida: bool = False


def fuentes_habilitadas() -> frozenset[str]:
    """Orígenes que esta instancia acepta.

    Viene de settings (y por ahí del entorno), no del sobre: operaciones puede
    deshabilitar correo sin tocar código ni dejar de publicar en connectors.
    """
    configurado = getattr(
        settings, "CONFIRMACIONES_FUENTES_HABILITADAS", FUENTES_POR_DEFECTO
    )
    if isinstance(configurado, str):
        configurado = configurado.split(",")
    return frozenset(
        str(fuente).strip().lower() for fuente in configurado if str(fuente).strip()
    )


def normalizar_servicio(valor: str) -> str:
    """Clave estable para emparejar y bloquear por servicio."""
    sin_tildes = unicodedata.normalize("NFKD", str(valor or "")).casefold()
    sin_marcas = "".join(c for c in sin_tildes if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", sin_marcas))


def fecha_mas_un_mes(fecha: date) -> date:
    """Un periodo mensual con el día recortado al último del mes destino."""
    anio = fecha.year + (fecha.month == 12)
    mes = 1 if fecha.month == 12 else fecha.month + 1
    return date(anio, mes, min(fecha.day, calendar.monthrange(anio, mes)[1]))


def fecha_proxima(fecha: date, tipo_mensaje: str) -> date | None:
    """La fecha que debe quedar en la suscripción. `None` = no tocarla."""
    if tipo_mensaje == "aviso_de_cobro":
        return fecha
    if tipo_mensaje == "cobro_realizado":
        return fecha_mas_un_mes(fecha)
    return None


def leer_confirmacion(cuerpo: bytes) -> tuple[dict, dict]:
    """Valida el sobre completo y normaliza lo que se va a escribir."""
    try:
        sobre = json.loads(cuerpo)
    except (TypeError, ValueError) as exc:
        raise ConfirmacionInvalida(f"no es JSON: {exc}") from exc

    fallos = errores_de_contrato(sobre)
    if fallos:
        raise ConfirmacionInvalida(
            "no cumple el contrato candidato.confirmado v1 — "
            + "; ".join(fallos[:5])
        )
    if (sobre.get("evento"), sobre.get("version")) != (EVENTO, VERSION):
        raise ConfirmacionInvalida(
            f"evento no admitido en esta cola: {sobre.get('evento')!r} "
            f"v{sobre.get('version')!r}"
        )

    datos = dict(sobre["datos"])
    if not datos.get("servicio"):
        # La API de confirmación no deja pasar un servicio sin resolver; si
        # llega igual, crear una suscripción con la glosa sería inventar dato.
        raise ConfirmacionInvalida("servicio sin resolver en el evento confirmado")
    try:
        datos["candidato_id"] = uuid.UUID(str(datos["candidato_id"]))
        datos["importe"] = Decimal(datos["importe"])
        datos["fecha"] = date.fromisoformat(datos["fecha"])
    except (ValueError, TypeError, InvalidOperation) as exc:
        raise ConfirmacionInvalida(f"datos del sobre inválidos: {exc}") from exc
    if datos["importe"] <= 0:
        raise ConfirmacionInvalida("el importe debe ser positivo")
    return sobre, datos


def _acreditar(evento_id, organizacion_id, hecho_por=HECHO_POR_CONSUMIDOR):
    """Evidencia durable de que ESTE evento ya se aplicó."""
    TrabajoDerivado.objects.get_or_create(
        evento_id=evento_id,
        trabajo=TRABAJO,
        defaults={"organizacion_id": organizacion_id, "hecho_por": hecho_por},
    )


def _buscar_suscripcion(organizacion_id, clave: str) -> Subscription | None:
    for candidata in Subscription.objects.filter(
        organizacion_id=organizacion_id, activo=True
    ).only("id", "nombre"):
        if normalizar_servicio(candidata.nombre) == clave:
            return candidata
    return None


def _crear_suscripcion(organizacion_id, datos: dict, fecha_inicial: date) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=organizacion_id,
        nombre=datos["servicio"],
        monto=datos["importe"],
        moneda=datos["moneda"],
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=fecha_inicial,
        categoria="otro",
    )


def _aplicar(sobre: dict, datos: dict) -> Resultado:
    """Todo el efecto, dentro de una sola transacción."""
    evento_id = uuid.UUID(str(sobre["id"]))
    organizacion_id = uuid.UUID(str(sobre["organizacion_id"]))
    correlation_id = sobre["correlation_id"]
    candidato_id = datos["candidato_id"]

    with transaction.atomic():
        # FOR SHARE, no FOR UPDATE: no bloquea las escrituras HTTP del tenant.
        estado = bloquear_organizacion(organizacion_id, compartido=True)
        if estado.eliminada:
            registro.info(
                "confirmacion.omitida evento=%s candidato=%s fuente=%s "
                "motivo=organizacion_eliminada",
                EVENTO, candidato_id, datos["origen"],
            )
            return Resultado(confirmar=True, motivo="organizacion_eliminada", omitida=True)

        clave = normalizar_servicio(datos["servicio"])
        bloquear("confirmacion_candidato", organizacion_id, clave)

        ya_acreditado = TrabajoDerivado.objects.filter(
            evento_id=evento_id, trabajo=TRABAJO
        ).exists()
        cobro_ya_creado = Cobro.objects.filter(
            organizacion_id=organizacion_id, candidato_id=candidato_id
        ).exists()
        if ya_acreditado or cobro_ya_creado:
            # Otra entrega (o la misma con otro evento_id) ya lo hizo. Acreditar
            # este evento también, para que una tercera entrega no rehaga nada.
            _acreditar(evento_id, organizacion_id)
            return Resultado(
                confirmar=True, motivo="ya_aplicada", aplicada=False, omitida=True
            )

        proxima = fecha_proxima(datos["fecha"], datos["tipo_mensaje"])
        suscripcion = _buscar_suscripcion(organizacion_id, clave)
        creada = suscripcion is None
        if creada:
            # La semilla de una suscripción nueva es la fecha del sobre; para
            # un pago fallido no hay otra fecha disponible (ver SUPUESTOS).
            suscripcion = _crear_suscripcion(
                organizacion_id, datos, proxima or datos["fecha"]
            )
            registrar_creada(suscripcion, correlation_id=correlation_id)

        # Dos vocabularios: `save()` quiere campos del MODELO y el evento v2
        # quiere los del CONTRATO. Mezclarlos rompe el alta de cobro (el error
        # aparece recién cuando la suscripción ya existía y había que guardar).
        campos_modelo = set()
        campos_evento = set()
        # Nunca se cambia la moneda de una suscripción existente. El monto sí
        # se actualiza cuando la del sobre coincide: es el mismo contrato en
        # la misma divisa, no una conversión inventada.
        if not creada and datos["moneda"] == suscripcion.moneda:
            if suscripcion.monto != datos["importe"]:
                suscripcion.monto = datos["importe"]
                campos_modelo.add("monto")
                campos_evento.add("monto")
        if proxima is not None and not creada and suscripcion.fecha_proximo_cobro != proxima:
            suscripcion.fecha_proximo_cobro = proxima
            campos_modelo.add("fecha_proximo_cobro")
            campos_evento.add("proximo_cobro")
        if campos_modelo:
            suscripcion.save(update_fields=sorted(campos_modelo))

        cobro_creado = False
        if datos["crear_cobro"]:
            Cobro.objects.create(
                organizacion_id=organizacion_id,
                suscripcion=suscripcion,
                monto=datos["importe"],
                moneda=datos["moneda"],
                fecha=datos["fecha"],
                origen=datos["origen"],
                candidato_id=candidato_id,
            )
            cobro_creado = True
            # Aunque la fecha ya fuera la misma, el alta del cobro es un hecho
            # que otros consumidores deben ver (SUPUESTO del sobre v2).
            campos_evento.add("proximo_cobro")

        actualizada = False
        if campos_evento:
            registrar_actualizada(
                suscripcion, sorted(campos_evento), correlation_id=correlation_id
            )
            actualizada = True

        _acreditar(evento_id, organizacion_id)
        return Resultado(
            confirmar=True,
            aplicada=True,
            creada=creada,
            cobro_creado=cobro_creado,
            actualizada=actualizada,
        )


def procesar_confirmacion(
    cuerpo: bytes, *, dormir=time.sleep, avisar=None
) -> Resultado:
    """Aplica la orden y dice si se confirma o se aparta. No toca el canal."""
    avisar = avisar or (lambda _texto: None)
    try:
        sobre, datos = leer_confirmacion(cuerpo)
    except ConfirmacionInvalida as error:
        return Resultado(confirmar=False, motivo=str(error))

    if datos["origen"] not in fuentes_habilitadas():
        # ACK, pero NUNCA silencioso: si una fuente está apagada, tiene que
        # quedar rastro de que se descartó una orden y de cuál fue.
        registro.info(
            "confirmacion.omitida evento=%s candidato=%s fuente=%s "
            "motivo=fuente_no_habilitada",
            sobre["evento"], datos["candidato_id"], datos["origen"],
        )
        return Resultado(confirmar=True, motivo="fuente_no_habilitada", omitida=True)

    ultimo = None
    espera = ESPERA_INICIAL
    for intento in range(1, INTENTOS + 1):
        try:
            return _aplicar(sobre, datos)
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
        except IntegrityError as error:
            # La restricción parcial ganó: otro evento con el MISMO candidato
            # ya creó el cobro. Es idempotencia, no un fallo del mensaje.
            registro.info(
                "confirmacion.omitida evento=%s candidato=%s fuente=%s "
                "motivo=candidato_ya_acreditado error=%s",
                sobre["evento"], datos["candidato_id"], datos["origen"], error,
            )
            return Resultado(confirmar=True, motivo="candidato_ya_acreditado", omitida=True)
        except Exception as error:  # noqa: BLE001
            return Resultado(confirmar=False, motivo=f"error al aplicar: {error}")

    return Resultado(
        confirmar=False,
        motivo=f"base no disponible tras {INTENTOS} intentos: {ultimo}",
    )

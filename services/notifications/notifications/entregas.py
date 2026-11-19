"""Entregar las alertas por correo (y push, cuando exista) y anotar qué pasó (S3-FE-21).

── El recorrido ─────────────────────────────────────────────────────────────

    generar_alertas ─ crea la alerta ─▶ planificar(): una EntregaAlerta por
                                        persona y canal externo que la quiere
    despachar_alertas ─▶ elegibles ─▶ reclamar() ─ transacción corta ─▶ enviando
                                          │  preferencias, canal, descanso,
                                          │  cuota y destino, bajo bloqueo
                                          ▼
                                   canal.enviar() ── fuera de la transacción
                                          │
                     aceptada ◀── anotar() ──▶ reintento · fallida · agotada

Solo `aceptada` es entregada, y solo con la respuesta del proveedor. Crear la
fila, diferirla o reclamarla no lo es.

── A quién ──────────────────────────────────────────────────────────────────
A cada persona conocida de la organización que quiere ese tipo de aviso, una
fila por canal externo encendido (correo, push). Conocida es tener fila de
preferencias o dirección de correo; quien nunca guardó preferencias recibe
con las de omisión, que son las que la pantalla le muestra como suyas
(`PreferenciaNotificacion.de_la_organizacion`). Filtrar por
`organizacion_id` es la comprobación de pertenencia que pide MX-21. Una
organización sin ninguna persona conocida recibe la alerta en la aplicación
pero no tiene a quién mandarle un correo.

Cuando FE-24 emita `alerta.activada` y exista el consumidor de
`notifications.entregas.v2`, ese consumidor llama a `planificar()` en vez del
generador. La restricción única lo hace idempotente ante reentregas.

── Dos workers no mandan dos veces lo mismo ─────────────────────────────────
`reclamar()` toma, en este orden y en una transacción corta:

1. la fila de preferencias de la persona (`FOR UPDATE`): serializa a todos
   los que quieren mandarle algo, que es lo que hace exacta la cuota diaria;
2. la entrega, releída con el filtro de elegibles: si otro worker ya la
   reclamó, ya no es elegible y se deja.

Y la deja en `enviando` con un `reclamo_id` nuevo y `reclamada_hasta`. El
envío va DESPUÉS del commit: una conexión SMTP lenta no deja filas
bloqueadas. El resultado se anota solo si el reclamo sigue siendo el mismo.

── Lo que NO se garantiza ───────────────────────────────────────────────────
Exactamente una entrega. Si el worker muere después de que el servidor
aceptó y antes de anotarlo, el reclamo vence y otro worker la vuelve a
mandar. Lo mismo con un timeout: no demuestra que el servidor no la
procesó. Por eso el reintento lleva el mismo Message-ID, que es la clave
de idempotencia del canal (MX-21 pide «idempotencia del canal» para las
entregas externas); muchos buzones descartan el repetido, pero no todos.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
import zoneinfo
from dataclasses import dataclass, field

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from . import canales
from .canales import Envio, ErrorDeEnvio
from .models import Alerta, EntregaAlerta, PreferenciaNotificacion
from .politica_envio import POR_CANAL, SIN_RESTRICCIONES, cuando_enviar

log = logging.getLogger(__name__)

Estado = EntregaAlerta.Estado

#: Los canales que salen de la aplicación. `in_app` es la alerta misma.
CANALES_EXTERNOS = tuple(EntregaAlerta.Canal.values)

#: Espera después de cada intento fallido por un error transitorio. Después
#: del último fallo ya no se espera: queda `agotada`. Son 5 intentos en
#: algo más de 2 h 36 min, más lo que tarde en pasar el despachador.
ESPERAS_REINTENTO = (
    dt.timedelta(minutes=1),
    dt.timedelta(minutes=5),
    dt.timedelta(minutes=30),
    dt.timedelta(hours=2),
)
MAX_INTENTOS = len(ESPERAS_REINTENTO) + 1

#: Cuánto dura un reclamo. Mucho más que `EMAIL_TIMEOUT` (5 s): vence solo
#: si el worker murió o se colgó, no porque el servidor tardó.
DURACION_RECLAMO = dt.timedelta(minutes=5)

#: Cuántas entregas atiende una corrida como máximo. El resto queda para la
#: siguiente: elegibles no se pierden, solo esperan.
LIMITE_POR_CORRIDA = 200

#: Desenlaces de atender una entrega.
ACEPTADA = Estado.ACEPTADA.value
DIFERIDA = Estado.DIFERIDA.value
REINTENTO = Estado.REINTENTO.value
FALLIDA = Estado.FALLIDA.value
AGOTADA = Estado.AGOTADA.value
DESCARTADA = Estado.DESCARTADA.value
SIN_TOCAR = "sin_tocar"    # otro worker la tenía o ya no estaba
TARDIA = "tardia"          # el reclamo venció antes de anotar el resultado

#: Por qué se descarta una entrega de quien no tiene fila de preferencias:
#: las de omisión no piden ese canal. No es lo mismo que haberlo apagado.
MOTIVO_POR_OMISION = "preferencia_por_omision"


def zona_de(_usuario_id) -> dt.tzinfo:
    """La zona horaria de la persona.

    Ningún modelo la guarda todavía (FE-22): todas las personas son de la
    zona del servicio, `America/Santiago`. Va en una función para que FE-22
    la cambie en un solo lugar.
    """
    return zoneinfo.ZoneInfo(settings.TIME_ZONE)


# ═══════════════════════════════════════════════════════════════════════
# Planificar
# ═══════════════════════════════════════════════════════════════════════

def planificar(alerta: Alerta, *, ahora: dt.datetime | None = None) -> int:
    """Una entrega por persona y canal externo encendido. Devuelve cuántas.

    Se llama dentro de la transacción que crea la alerta: o quedan las dos
    cosas o ninguna. Con la restricción única, planificar dos veces la misma
    alerta no duplica (`ignore_conflicts`), y se devuelve un conteo
    consultado porque `bulk_create` con `ignore_conflicts` devuelve los
    objetos aunque la base los haya descartado.
    """
    ahora = ahora or timezone.now()
    filas = [
        EntregaAlerta(
            organizacion_id=alerta.organizacion_id,
            alerta=alerta,
            usuario_id=preferencia.usuario_id,
            canal=canal,
            proximo_intento_en=ahora,
        )
        for preferencia in PreferenciaNotificacion.de_la_organizacion(alerta.organizacion_id)
        for canal in CANALES_EXTERNOS
        if preferencia.debe_avisar(alerta.tipo, canal)
    ]
    if filas:
        EntregaAlerta.objects.bulk_create(filas, ignore_conflicts=True)
    return EntregaAlerta.objects.filter(alerta=alerta).count()


# ═══════════════════════════════════════════════════════════════════════
# Reclamar
# ═══════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Reclamo:
    """Una entrega en `enviando`, lista para mandarse fuera de la transacción."""

    entrega_id: uuid.UUID
    reclamo_id: uuid.UUID
    canal: str
    intentos: int
    envio: Envio


def elegibles(ahora: dt.datetime):
    """Las que se pueden intentar ahora, incluidas las de un reclamo vencido."""
    return EntregaAlerta.objects.filter(
        Q(estado__in=[Estado.PENDIENTE, Estado.DIFERIDA, Estado.REINTENTO], proximo_intento_en__lte=ahora)
        | Q(estado=Estado.ENVIANDO, reclamada_hasta__lte=ahora)
    )


def _cerrar(entrega: EntregaAlerta, estado: str, ahora, *, motivo="", error: ErrorDeEnvio | None = None) -> str:
    entrega.estado = estado
    entrega.motivo = motivo
    if error is not None:
        entrega.codigo_error = error.codigo
        entrega.detalle_error = error.detalle
    entrega.reclamo_id = None
    entrega.reclamada_hasta = None
    entrega.save(update_fields=[
        "estado", "motivo", "codigo_error", "detalle_error",
        "reclamo_id", "reclamada_hasta", "actualizado_en",
    ])
    return estado


def _enviadas_en(entrega: EntregaAlerta, ahora):
    """Para la cuota: las aceptadas en el intervalo y las que están saliendo.

    Las `enviando` de reclamo vigente cuentan aunque no se sepa todavía si
    salen: si no contaran, dos workers que reclaman a la vez dos entregas de
    la misma persona verían las dos el mismo número y pasarían las dos.
    """
    def contar(inicio, fin) -> int:
        return (
            EntregaAlerta.objects.filter(
                organizacion_id=entrega.organizacion_id,
                usuario_id=entrega.usuario_id,
                canal=entrega.canal,
            )
            .filter(
                Q(estado=Estado.ACEPTADA, aceptada_en__gte=inicio, aceptada_en__lt=fin)
                | Q(estado=Estado.ENVIANDO, reclamada_hasta__gt=ahora)
            )
            .exclude(pk=entrega.pk)
            .count()
        )
    return contar


def _envio(entrega: EntregaAlerta, destino: str) -> Envio:
    alerta = entrega.alerta
    return Envio(
        destino=destino,
        asunto=f"{alerta.titulo} · Ojo al Gasto",
        cuerpo=(
            f"{alerta.mensaje}\n\n"
            "Recibes este aviso porque lo tienes activado en Ajustes > Alertas "
            "de Ojo al Gasto. Desde ahí puedes apagarlo o cambiar el canal."
        ),
        message_id=entrega.message_id,
    )


def reclamar(entrega_id, *, ahora: dt.datetime) -> Reclamo | str:
    """Decide qué hacer con una entrega y, si toca mandarla, la reclama.

    Devuelve un `Reclamo` o el desenlace cuando no hay nada que mandar.
    Todo lo que se decide acá se decide bajo bloqueo y se confirma junto.
    """
    with transaction.atomic():
        clave = (
            EntregaAlerta.objects.filter(pk=entrega_id)
            .values("organizacion_id", "usuario_id")
            .first()
        )
        if clave is None:
            return SIN_TOCAR
        # 1) La persona primero. El mismo orden que la limpieza de la
        #    organización y la de usuario (preferencias, después entregas):
        #    con dos órdenes distintos se pueden trabar entre ellos.
        preferencia = PreferenciaNotificacion.objects.select_for_update().filter(**clave).first()
        # 2) La entrega, releída bajo bloqueo con el filtro de elegibles.
        entrega = (
            elegibles(ahora)
            .select_for_update(of=("self",))
            .select_related("alerta")
            .filter(pk=entrega_id)
            .first()
        )
        if entrega is None:
            return SIN_TOCAR

        if entrega.estado == Estado.ENVIANDO and entrega.intentos >= MAX_INTENTOS:
            # El último intento no informó resultado (el worker murió).
            return _cerrar(entrega, AGOTADA, ahora, error=ErrorDeEnvio(
                "sin_resultado", "el último intento no informó resultado", permanente=False,
            ))
        motivo_descarte = "preferencia_apagada"
        if preferencia is None:
            # Nunca guardó preferencias: valen las de omisión, igual que al
            # planificar. No hay fila que bloquear, y no hace falta: la cuota
            # es del push, y `por_push` nace apagado, así que sin fila no
            # sale ningún push que contar.
            preferencia = PreferenciaNotificacion(**clave)
            motivo_descarte = MOTIVO_POR_OMISION
        if not preferencia.debe_avisar(entrega.alerta.tipo, entrega.canal):
            # Se mira de nuevo al mandar: pudo apagarlo después de planificar.
            return _cerrar(entrega, DESCARTADA, ahora, motivo=motivo_descarte)
        if not canales.disponible(entrega.canal):
            return _cerrar(entrega, FALLIDA, ahora, error=ErrorDeEnvio(
                "canal_no_disponible",
                f"no hay proveedor configurado para {entrega.canal}",
                permanente=True,
            ))

        politica = POR_CANAL.get(entrega.canal, SIN_RESTRICCIONES)
        espera = cuando_enviar(
            politica, ahora, zona_de(entrega.usuario_id), _enviadas_en(entrega, ahora),
        )
        if espera is not None:
            entrega.estado = Estado.DIFERIDA
            entrega.motivo = espera.motivo
            entrega.proximo_intento_en = espera.hasta
            entrega.reclamo_id = None
            entrega.reclamada_hasta = None
            entrega.save(update_fields=[
                "estado", "motivo", "proximo_intento_en",
                "reclamo_id", "reclamada_hasta", "actualizado_en",
            ])
            return DIFERIDA

        canal = canales.CANALES[entrega.canal]
        try:
            destino = canal.destino(entrega.organizacion_id, entrega.usuario_id)
        except ErrorDeEnvio as error:
            return _cerrar(entrega, FALLIDA, ahora, error=error)
        if destino is None:
            return _cerrar(entrega, FALLIDA, ahora, error=ErrorDeEnvio(
                "sin_direccion", "no se conoce a dónde mandarle a esta persona", permanente=True,
            ))

        entrega.estado = Estado.ENVIANDO
        entrega.motivo = ""
        entrega.reclamo_id = uuid.uuid4()
        entrega.reclamada_hasta = ahora + DURACION_RECLAMO
        entrega.intentos += 1
        entrega.ultimo_intento_en = ahora
        entrega.destino = destino
        entrega.message_id = entrega.message_id or canal.message_id(entrega.pk)
        entrega.save(update_fields=[
            "estado", "motivo", "reclamo_id", "reclamada_hasta", "intentos",
            "ultimo_intento_en", "destino", "message_id", "actualizado_en",
        ])
        return Reclamo(
            entrega_id=entrega.pk,
            reclamo_id=entrega.reclamo_id,
            canal=entrega.canal,
            intentos=entrega.intentos,
            envio=_envio(entrega, destino),
        )


# ═══════════════════════════════════════════════════════════════════════
# Anotar el resultado
# ═══════════════════════════════════════════════════════════════════════

def _anotar(reclamo: Reclamo, ahora, **campos) -> bool:
    """UPDATE condicionado al reclamo: si venció y otro la retomó, no se toca."""
    return bool(
        EntregaAlerta.objects.filter(
            pk=reclamo.entrega_id, estado=Estado.ENVIANDO, reclamo_id=reclamo.reclamo_id,
        ).update(reclamo_id=None, reclamada_hasta=None, actualizado_en=ahora, **campos)
    )


def anotar_aceptada(reclamo: Reclamo, evidencia: dict, *, ahora) -> str:
    anotada = _anotar(
        reclamo, ahora,
        estado=Estado.ACEPTADA, aceptada_en=ahora, evidencia=evidencia,
        codigo_error="", detalle_error="",
    )
    return ACEPTADA if anotada else TARDIA


def anotar_error(reclamo: Reclamo, error: ErrorDeEnvio, *, ahora) -> str:
    if error.permanente:
        estado, proximo = Estado.FALLIDA, {}
    elif reclamo.intentos >= MAX_INTENTOS:
        estado, proximo = Estado.AGOTADA, {}
    else:
        estado = Estado.REINTENTO
        proximo = {"proximo_intento_en": ahora + ESPERAS_REINTENTO[reclamo.intentos - 1]}
    anotada = _anotar(
        reclamo, ahora,
        estado=estado, codigo_error=error.codigo, detalle_error=error.detalle, **proximo,
    )
    return estado.value if anotada else TARDIA


# ═══════════════════════════════════════════════════════════════════════
# Despachar
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class Resumen:
    """Qué pasó en una corrida. `problemas` lleva lo que no se aceptó, para
    mostrarlo sin la dirección ni el contenido."""

    conteo: dict = field(default_factory=dict)
    problemas: list = field(default_factory=list)

    def anotar(self, entrega_id, desenlace: str) -> None:
        self.conteo[desenlace] = self.conteo.get(desenlace, 0) + 1
        if desenlace in (FALLIDA, AGOTADA, REINTENTO, TARDIA):
            self.problemas.append((entrega_id, desenlace))

    def __getitem__(self, desenlace: str) -> int:
        return self.conteo.get(desenlace, 0)


def atender(entrega_id, *, ahora: dt.datetime | None = None) -> str:
    """Reclama, manda y anota una entrega. Devuelve el desenlace."""
    reclamo = reclamar(entrega_id, ahora=ahora or timezone.now())
    if not isinstance(reclamo, Reclamo):
        return reclamo
    canal = canales.CANALES[reclamo.canal]
    try:
        evidencia = canal.enviar(reclamo.envio)
    except ErrorDeEnvio as error:
        desenlace = anotar_error(reclamo, error, ahora=ahora or timezone.now())
        # Sin destino ni contenido: id, canal y código alcanzan para buscarla.
        log.warning(
            "entrega %s por %s: %s (%s, intento %s)",
            reclamo.entrega_id, reclamo.canal, error.codigo, desenlace, reclamo.intentos,
        )
        return desenlace
    except Exception as error:  # noqa: BLE001 — límite de integración, ver abajo
        # Un fallo que el canal no supo clasificar (un error de programación,
        # un backend raro). Política: se trata como transitorio, así que se
        # reintenta con espera y termina `agotada` si se repite; la corrida
        # sigue con las demás. Se anota el tipo, nunca el mensaje completo.
        inesperado = ErrorDeEnvio("inesperado", type(error).__name__, permanente=False)
        desenlace = anotar_error(reclamo, inesperado, ahora=ahora or timezone.now())
        log.error(
            "entrega %s por %s: error no clasificado %s (%s)",
            reclamo.entrega_id, reclamo.canal, type(error).__name__, desenlace,
        )
        return desenlace
    return anotar_aceptada(reclamo, evidencia, ahora=ahora or timezone.now())


def despachar(*, ahora: dt.datetime | None = None, limite: int = LIMITE_POR_CORRIDA) -> Resumen:
    """Atiende hasta `limite` entregas elegibles, las más antiguas primero.

    `ahora` fija el reloj de toda la corrida (para reproducir un instante);
    sin él, cada entrega usa la hora real en que se atiende.
    """
    if limite < 1:
        raise ValueError("el límite es de al menos 1")
    corte = ahora or timezone.now()
    pendientes = list(
        elegibles(corte)
        .order_by("proximo_intento_en", "id")
        .values_list("pk", flat=True)[:limite]
    )
    resumen = Resumen()
    for entrega_id in pendientes:
        resumen.anotar(entrega_id, atender(entrega_id, ahora=ahora))
    return resumen

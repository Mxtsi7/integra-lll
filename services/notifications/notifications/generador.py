"""Generar alertas de próximos cobros (FE-17) y de fin de prueba (FE-18).

Dos funciones puras sobre la proyección (`SuscripcionVigilada`) y las
preferencias (`PreferenciaNotificacion`). No miran el reloj: `ahora` es un
parámetro. Así una prueba puede decir "es el 21 de noviembre a las 10" y
comprobar exactamente qué sale, y el comando `generar_alertas` puede
reproducir cualquier día.

── Las dos reglas que deciden si se avisa ───────────────────────────────────
1. **La suscripción está vigente**: `activo` o `prueba`. Una cancelada, por
   confirmar o fantasma no genera aviso aunque tenga fecha de cobro.
2. **Alguien de la organización quiere el aviso**: una preferencia con el
   tipo encendido y al menos un canal elegido. Si la organización no tiene
   ninguna preferencia guardada, valen las de omisión (los avisos vienen
   encendidos y la anticipación es de 3 días, igual que lo que vería esa
   persona al abrir la pantalla de FE-21 por primera vez). Si hay
   preferencias y todas apagan el tipo, no se avisa.

── Cada ventana produce a lo sumo una alerta ────────────────────────────────
No se lleva una lista de "ya avisé": la alerta lleva un `evento_id`
DETERMINÍSTICO (UUID v5 de organización, suscripción, tipo, fecha y ventana)
y la restricción única de `Alerta` hace el resto. Correr el generador diez
veces el mismo día deja una sola alerta; correrlo mañana para el mismo cobro
y la misma ventana, también. Es la misma idempotencia que FE-24 va a usar con
los eventos reales, sin estado aparte que se pueda desincronizar.

── Próximo cobro (FE-17) ────────────────────────────────────────────────────
La ventana es la anticipación configurada: se avisa cuando faltan `dias` o
menos (y todavía no pasó). Es "o menos" y no "exactamente": el job corre una
vez al día y si un día no corre, el aviso igual sale al siguiente. Con dos
personas que piden 3 y 7 días, salen dos alertas para la organización: una
por ventana. Las alertas son de la organización (así está modelado FE-16),
no de la persona.

── Fin de prueba (FE-18) ────────────────────────────────────────────────────
Dos ventanas fijas, 48 h y 24 h antes de que termine, una alerta por cada
una. Son las que piden los requisitos y NO se mezclan con `dias_anticipacion`
(que gobierna los cobros): si una persona pidió 7 días de anticipación para
los cobros, el fin de prueba igual se avisa a las 48 h y a las 24 h. Queda
documentado acá como la prioridad de reglas que pedía la tarjeta, y se
puede revisar antes de activar el envío por correo o push (FE-22).

La prueba "termina" al empezar el día `fin_prueba` (00:00 hora de Chile):
es el primer instante en que ya no es gratis, y avisar contra ese límite es
lo conservador. Sin fecha (`fin_prueba` NULL) no se avisa.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Alerta, PreferenciaNotificacion, SuscripcionVigilada

#: Espacio de los ids determinísticos. Cambiarlo haría que todas las
#: alertas "nuevas" dejaran de chocar con las ya creadas: no tocar.
ESPACIO_ALERTAS = uuid.UUID("5f3a1c2e-7b4d-4e8f-9a0b-1c2d3e4f5a6b")

#: Las ventanas de FE-18, en horas, de la más lejana a la más cercana.
VENTANAS_FIN_PRUEBA = (48, 24)


def id_de_ventana(organizacion_id, suscripcion_id, tipo: str, fecha, ventana) -> uuid.UUID:
    """El `evento_id` de una alerta generada. Igual para la misma ventana."""
    return uuid.uuid5(
        ESPACIO_ALERTAS,
        f"{organizacion_id}:{suscripcion_id}:{tipo}:{fecha}:{ventana}",
    )


@dataclass
class Resultado:
    """Qué hizo una corrida. `creadas` son alertas nuevas; `repetidas`, las
    que ya existían para esa ventana (lo normal al correr dos veces)."""

    creadas: list[Alerta] = field(default_factory=list)
    repetidas: int = 0
    revisadas: int = 0

    def __iadd__(self, otro: "Resultado") -> "Resultado":
        self.creadas.extend(otro.creadas)
        self.repetidas += otro.repetidas
        self.revisadas += otro.revisadas
        return self


def _anticipacion_por_omision() -> int:
    return PreferenciaNotificacion._meta.get_field("dias_anticipacion").default


def _preferencias(organizacion_id) -> list[PreferenciaNotificacion]:
    return list(PreferenciaNotificacion.objects.filter(organizacion_id=organizacion_id))


def anticipaciones_de_cobro(organizacion_id) -> set[int]:
    """Con cuántos días de anticipación hay que avisar un cobro en esta
    organización. Vacío = nadie quiere el aviso."""
    preferencias = _preferencias(organizacion_id)
    if not preferencias:
        return {_anticipacion_por_omision()}
    return {
        p.dias_anticipacion
        for p in preferencias
        if p.quiere(Alerta.Tipo.PROXIMO_COBRO) and p.canales_elegidos()
    }


def alguien_quiere_fin_de_prueba(organizacion_id) -> bool:
    preferencias = _preferencias(organizacion_id)
    if not preferencias:
        return True
    return any(
        p.quiere(Alerta.Tipo.FIN_PRUEBA) and p.canales_elegidos() for p in preferencias
    )


def _crear_una_vez(**campos) -> tuple[Alerta | None, bool]:
    """Crea la alerta si su ventana no tiene una. (alerta, era_nueva)."""
    try:
        with transaction.atomic():
            return Alerta.objects.create(**campos), True
    except IntegrityError:
        # La restricción única (organización, evento_id): esta ventana ya
        # avisó. Es el camino normal de la segunda corrida del día.
        return None, False


def _texto_monto(suscripcion: SuscripcionVigilada) -> str:
    monto = f"{suscripcion.monto:,.0f}".replace(",", ".")
    return f"{monto} {suscripcion.moneda}"


def generar_proximos_cobros(*, ahora: dt.datetime) -> Resultado:
    """FE-17. Avisa los cobros que caen dentro de la anticipación configurada."""
    hoy = timezone.localdate(ahora)
    resultado = Resultado()
    vigiladas = SuscripcionVigilada.objects.filter(
        estado__in=SuscripcionVigilada.ESTADOS_VIGENTES,
        proximo_cobro__isnull=False,
        proximo_cobro__gte=hoy,
    ).order_by("organizacion_id", "proximo_cobro")

    anticipaciones: dict = {}
    for suscripcion in vigiladas:
        resultado.revisadas += 1
        org = suscripcion.organizacion_id
        if org not in anticipaciones:
            anticipaciones[org] = anticipaciones_de_cobro(org)
        faltan = (suscripcion.proximo_cobro - hoy).days
        for dias in sorted(anticipaciones[org]):
            if faltan > dias:
                continue  # todavía no entra en esta ventana
            alerta, nueva = _crear_una_vez(
                organizacion_id=org,
                tipo=Alerta.Tipo.PROXIMO_COBRO,
                titulo=f"{suscripcion.nombre or 'Una suscripción'} se cobra "
                       + ("hoy" if faltan == 0 else f"en {faltan} día{'s' if faltan != 1 else ''}"),
                mensaje=(
                    f"El cobro de {_texto_monto(suscripcion)} de "
                    f"{suscripcion.nombre or 'la suscripción'} está programado para el "
                    f"{suscripcion.proximo_cobro:%d-%m-%Y}."
                ),
                suscripcion_id=suscripcion.suscripcion_id,
                evento_id=id_de_ventana(
                    org, suscripcion.suscripcion_id, Alerta.Tipo.PROXIMO_COBRO,
                    suscripcion.proximo_cobro, dias,
                ),
                datos={
                    "origen": "generador",
                    "fecha_cobro": suscripcion.proximo_cobro.isoformat(),
                    "dias_faltantes": faltan,
                    "anticipacion_dias": dias,
                    "monto": str(suscripcion.monto),
                    "moneda": suscripcion.moneda,
                },
            )
            if nueva:
                resultado.creadas.append(alerta)
            else:
                resultado.repetidas += 1
    return resultado


def _fin_de_prueba_en(suscripcion: SuscripcionVigilada) -> dt.datetime:
    """El instante en que deja de ser gratis: las 00:00 del día `fin_prueba`."""
    return timezone.make_aware(
        dt.datetime.combine(suscripcion.fin_prueba, dt.time.min),
        timezone.get_current_timezone(),
    )


def generar_fin_de_prueba(*, ahora: dt.datetime) -> Resultado:
    """FE-18. Avisa a las 48 h y a las 24 h de que termine una prueba."""
    resultado = Resultado()
    en_prueba = SuscripcionVigilada.objects.filter(
        estado="prueba", fin_prueba__isnull=False,
    ).order_by("organizacion_id", "fin_prueba")

    quiere: dict = {}
    for suscripcion in en_prueba:
        resultado.revisadas += 1
        org = suscripcion.organizacion_id
        if org not in quiere:
            quiere[org] = alguien_quiere_fin_de_prueba(org)
        if not quiere[org]:
            continue
        restante = _fin_de_prueba_en(suscripcion) - ahora
        if restante <= dt.timedelta(0):
            continue  # ya terminó: eso lo cuenta subscriptions, no un aviso
        horas = restante.total_seconds() / 3600
        for ventana in VENTANAS_FIN_PRUEBA:
            if horas > ventana:
                continue  # todavía no entra en esta ventana
            alerta, nueva = _crear_una_vez(
                organizacion_id=org,
                tipo=Alerta.Tipo.FIN_PRUEBA,
                titulo=f"La prueba de {suscripcion.nombre or 'una suscripción'} termina en menos de {ventana} h",
                mensaje=(
                    f"El período de prueba de {suscripcion.nombre or 'la suscripción'} "
                    f"termina el {suscripcion.fin_prueba:%d-%m-%Y}. Si no la cancelas "
                    f"antes, se cobra {_texto_monto(suscripcion)}."
                ),
                suscripcion_id=suscripcion.suscripcion_id,
                evento_id=id_de_ventana(
                    org, suscripcion.suscripcion_id, Alerta.Tipo.FIN_PRUEBA,
                    suscripcion.fin_prueba, f"{ventana}h",
                ),
                datos={
                    "origen": "generador",
                    "fin_prueba": suscripcion.fin_prueba.isoformat(),
                    "ventana_horas": ventana,
                    "horas_restantes": round(horas, 1),
                    "monto": str(suscripcion.monto),
                    "moneda": suscripcion.moneda,
                },
            )
            if nueva:
                resultado.creadas.append(alerta)
            else:
                resultado.repetidas += 1
    return resultado


def generar(*, ahora: dt.datetime | None = None) -> Resultado:
    """Las dos a la vez. `ahora` por omisión es el reloj real; las pruebas
    y el comando pueden fijarlo."""
    ahora = ahora or timezone.now()
    resultado = generar_proximos_cobros(ahora=ahora)
    resultado += generar_fin_de_prueba(ahora=ahora)
    return resultado

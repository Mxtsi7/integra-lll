"""Cuándo se puede mandar por un canal: horario de descanso y cuota diaria (S3-FE-21).

Funciones puras: reciben el instante, la zona y cuántas se mandaron ese día,
y devuelven `None` (se puede ahora) o una `Espera` con el instante desde el
que se puede. No leen la base ni el reloj, así que una prueba puede decir
"son las 23:00 del 21 de noviembre en Santiago" y ver exactamente qué pasa.

── De dónde salen los valores ───────────────────────────────────────────────
De las reglas de negocio del equipo (`docs/historico/REGLAS-DE-NEGOCIO.md`),
que FE-22 tiene que llevar a preferencias por persona:

· RN-09: no se envían push entre las 22:00 y las 08:00; lo que cae en esa
  franja se despacha a las 09:00.
· RN-08: máximo 2 push externos por persona y día.

Las dos hablan SOLO de push. Para el correo ninguna regla fija franja ni
cuota, así que el correo no tiene: inventarle una sería poner un contrato que
nadie acordó. Si FE-22 decide otra cosa, cambia `POR_CANAL` y nada más.

── La franja puede cruzar la medianoche ─────────────────────────────────────
22:00 → 08:00 es "desde las 22 o antes de las 8", no "entre 22 y 8" con un
`desde <= hora < hasta` que nunca es verdadero. Con `desde < hasta` (una
franja dentro del mismo día) vale la comparación directa.

── El día de la cuota es el día LOCAL ──────────────────────────────────────
A las 21:30 en Santiago ya es el día siguiente en UTC. Contar por día UTC
reiniciaría la cuota a media tarde y dejaría salir un tercer push el mismo
día para la persona (es el criterio de FE-22: "cambio de día no reinicia
incorrectamente el contador"). El día va de 00:00 a 00:00 en la zona dada.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Callable

MOTIVO_DESCANSO = "descanso"
MOTIVO_CUOTA = "cuota_diaria"


@dataclass(frozen=True)
class Politica:
    """Las restricciones de un canal. Sin valores, no restringe nada."""

    #: La franja en que no se manda. Las dos o ninguna.
    descanso_desde: dt.time | None = None
    descanso_hasta: dt.time | None = None
    #: A qué hora sale lo diferido. RN-09 dice 09:00 aunque la franja
    #: termine a las 08:00. Sin valor, sale al terminar la franja.
    reanudar_a: dt.time | None = None
    #: Cuántas por persona y día local. Sin valor, sin tope.
    cuota_diaria: int | None = None

    def __post_init__(self):
        if (self.descanso_desde is None) != (self.descanso_hasta is None):
            raise ValueError("la franja de descanso necesita inicio y fin")
        if self.descanso_desde is not None and self.descanso_desde == self.descanso_hasta:
            raise ValueError("una franja de descanso vacía o de 24 h no es una franja")
        if self.cuota_diaria is not None and self.cuota_diaria < 1:
            raise ValueError("la cuota diaria es de al menos 1")
        if self.reanudar_a is not None and self.en_descanso(self.reanudar_a):
            # Diferir hasta una hora que cae dentro de la franja la volvería
            # a diferir para siempre.
            raise ValueError("la hora de reanudación cae dentro del descanso")

    def en_descanso(self, hora: dt.time) -> bool:
        """¿Esta hora local cae en la franja de descanso?"""
        if self.descanso_desde is None:
            return False
        if self.descanso_desde < self.descanso_hasta:
            return self.descanso_desde <= hora < self.descanso_hasta
        # Cruza la medianoche: 22:00 → 08:00.
        return hora >= self.descanso_desde or hora < self.descanso_hasta

    @property
    def hora_de_salida(self) -> dt.time:
        """A qué hora sale lo que se difirió."""
        return self.reanudar_a or self.descanso_hasta or dt.time.min


@dataclass(frozen=True)
class Espera:
    hasta: dt.datetime
    motivo: str


SIN_RESTRICCIONES = Politica()

#: RN-08 y RN-09, solo para push.
PUSH = Politica(
    descanso_desde=dt.time(22, 0),
    descanso_hasta=dt.time(8, 0),
    reanudar_a=dt.time(9, 0),
    cuota_diaria=2,
)

POR_CANAL = {
    "email": SIN_RESTRICCIONES,
    "push": PUSH,
}


def dia_local(instante: dt.datetime, zona: dt.tzinfo) -> tuple[dt.datetime, dt.datetime]:
    """[inicio, fin) del día local que contiene a `instante`."""
    fecha = instante.astimezone(zona).date()
    inicio = dt.datetime.combine(fecha, dt.time.min, tzinfo=zona)
    fin = dt.datetime.combine(fecha + dt.timedelta(days=1), dt.time.min, tzinfo=zona)
    return inicio, fin


def _proxima(hora: dt.time, despues_de: dt.datetime, zona: dt.tzinfo) -> dt.datetime:
    """La próxima vez que el reloj local marca `hora`, estrictamente después."""
    local = despues_de.astimezone(zona)
    candidato = dt.datetime.combine(local.date(), hora, tzinfo=zona)
    if candidato <= local:
        candidato = dt.datetime.combine(local.date() + dt.timedelta(days=1), hora, tzinfo=zona)
    return candidato


def cuando_enviar(
    politica: Politica,
    ahora: dt.datetime,
    zona: dt.tzinfo,
    enviadas_en: Callable[[dt.datetime, dt.datetime], int],
) -> Espera | None:
    """`None` si se puede mandar ahora; si no, hasta cuándo esperar y por qué.

    `enviadas_en(inicio, fin)` cuenta las que ya salieron en ese intervalo.
    Es una función y no un número para que solo se consulte cuando el canal
    tiene cuota, y para que quien la llama decida cómo contar (bajo qué
    bloqueo, qué estados).
    """
    local = ahora.astimezone(zona)
    if politica.en_descanso(local.time()):
        return Espera(_proxima(politica.hora_de_salida, local, zona), MOTIVO_DESCANSO)
    if politica.cuota_diaria is not None:
        inicio, fin = dia_local(local, zona)
        if enviadas_en(inicio, fin) >= politica.cuota_diaria:
            # Al día siguiente, a la hora de salida: no a las 00:00, que
            # caería en el descanso y se volvería a diferir.
            return Espera(
                dt.datetime.combine(fin.date(), politica.hora_de_salida, tzinfo=zona),
                MOTIVO_CUOTA,
            )
    return None

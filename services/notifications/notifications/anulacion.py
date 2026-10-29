"""Anular o corregir las alertas que la suscripción dejó atrás (FE-23).

Una alerta es una afirmación con fecha: "se cobra el 12-11" o "la prueba
termina el 03-12". Cuando llega un evento que cambia la suscripción, algunas
de las que ya están en la campana pasan a ser **falsas**, y dejarlas ahí es
peor que no haber avisado: la persona cancela algo que ya estaba cancelado, o
confía en un monto que subió.

Corre como efecto del consumidor de dominio (FE-24), en la misma transacción
que la proyección: o se actualiza la vista de la suscripción y se limpian sus
alertas, o no pasa ninguna de las dos cosas.

── Anular NO es siempre lo correcto ────────────────────────────────────────
Es la trampa de esta tarjeta. Las alertas generadas llevan un `evento_id`
determinístico de (organización, suscripción, tipo, **fecha**, ventana), y la
restricción única impide crear dos para la misma ventana. O sea que anular una
alerta cuya fecha NO cambió la borra para siempre: el generador no la vuelve
a crear, porque chocaría con la que acabamos de anular.

Por eso hay dos caminos, según si el cambio mueve la fecha o no:

    la suscripción dejó de estar       → ANULAR. No hay nada que avisar.
    vigente (o salió de prueba)

    la fecha que anunciaba ya no es    → ANULAR. El generador creará la nueva
    la de la suscripción                 (otra fecha = otro `evento_id`), así
                                         que no queda hueco.

    misma fecha, cambió el monto, la   → CORREGIR el texto en su lugar.
    moneda o el nombre                   Anular acá dejaría a la persona sin
                                         aviso de un cobro que sigue en pie.

── No hace falta el estado anterior ───────────────────────────────────────
La comparación no es "antes vs ahora": es **lo que la alerta afirma** contra
lo que la suscripción dice ahora. El generador anota la fecha y el monto en
`datos`, así que cada alerta trae su propia afirmación y se puede juzgar sola.
Eso la hace inmune al orden de los mensajes: da igual si la proyección se
actualizó con este evento o con uno posterior, porque se juzga contra el
estado vigente y no contra un diff que puede llegar fuera de orden.

── Qué cuenta como "pendiente" ─────────────────────────────────────────────
La tarjeta dice "alertas pendientes". Acá se toman también las **leídas**: una
alerta leída sigue en el listado de FE-19, así que una leída que miente sigue
mintiendo. Las `revisada` no se tocan: la persona ya las cerró y volver a
escribirlas sería revivirlas.

── Anulada no es lo mismo que descartada por la persona ────────────────────
Las dos terminan en `revisada`, que es el estado que ya significa "cerrada sin
tocar la suscripción"; no hace falta un estado nuevo que el frontend no
conoce. La diferencia queda en `datos`: `anulada_por` dice qué evento la cerró
y `anulada_porque` por qué. Sin eso, "revisada" no distinguiría entre "la
revisé yo" y "el sistema la retiró", que es justo lo que alguien va a querer
saber cuando reclame que una alerta desapareció.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field

from django.db.models import Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import Alerta, SuscripcionVigilada

log = logging.getLogger(__name__)

#: Las alertas que este módulo puede tocar. Una `revisada` ya está cerrada.
ABIERTAS = (Alerta.Lectura.PENDIENTE, Alerta.Lectura.LEIDA)

#: Qué fecha afirma cada tipo de alerta: la llave con que el generador la
#: anotó en `datos`, y el campo de la suscripción contra el que se compara.
#: Un tipo que no esté acá no se juzga por fecha (un presupuesto excedido no
#: habla de una fecha de la suscripción), solo por vigencia.
FECHA_POR_TIPO = {
    Alerta.Tipo.PROXIMO_COBRO: ("fecha_cobro", "proximo_cobro"),
    Alerta.Tipo.FIN_PRUEBA: ("fin_prueba", "fin_prueba"),
}

#: Los tipos que solo tienen sentido durante la prueba.
SOLO_EN_PRUEBA = (Alerta.Tipo.FIN_PRUEBA,)


@dataclass
class Resultado:
    """Qué se hizo con las alertas de una suscripción."""

    anuladas: list[Alerta] = field(default_factory=list)
    corregidas: list[Alerta] = field(default_factory=list)
    #: Las que se dejaron tal cual porque seguían siendo ciertas.
    intactas: int = 0

    def __iadd__(self, otro: "Resultado") -> "Resultado":
        self.anuladas.extend(otro.anuladas)
        self.corregidas.extend(otro.corregidas)
        self.intactas += otro.intactas
        return self

    def __bool__(self) -> bool:
        return bool(self.anuladas or self.corregidas)


def _fecha_afirmada(alerta: Alerta, llave: str) -> dt.date | None:
    """La fecha que la alerta anunció, según sus propios `datos`.

    None cuando no se puede leer. Eso incluye las alertas que no nacieron del
    generador (una creada a mano, o de una versión anterior sin esa llave): no
    se las juzga por fecha, porque no se sabe qué fecha afirmaron, y
    anularlas por las dudas sería borrar información ajena.
    """
    crudo = (alerta.datos or {}).get(llave)
    if not crudo:
        return None
    try:
        return dt.date.fromisoformat(str(crudo))
    except ValueError:
        log.warning(
            "alerta %s tiene `datos.%s` ilegible (%r): no se juzga por fecha",
            alerta.pk, llave, crudo,
        )
        return None


def _anular(alerta: Alerta, *, evento_id, motivo: str, ahora) -> bool:
    """Cierra la alerta. Devuelve si esta llamada fue la que la cerró.

    El guardia va en el `WHERE`: el estado de lectura se comprueba dentro del
    mismo `UPDATE`, así que dos consumidores con el mismo mensaje no cierran
    los dos la misma alerta ni se pisan las fechas. `leida_en` se conserva con
    `Coalesce` —solo se rellena si estaba vacía— para no borrar cuándo la
    persona la vio de verdad.

    `datos` se escribe entero porque hay que fusionar con lo que ya tenía, y
    el operador de concatenación de JSON no existe en los dos motores que
    usamos. Es seguro: el `UPDATE` está condicionado al estado de lectura, así
    que si otro ganó la carrera este no escribe nada.
    """
    datos = dict(alerta.datos or {})
    datos["anulada_por"] = str(evento_id)
    datos["anulada_porque"] = motivo
    cambiadas = (
        Alerta.objects.filter(pk=alerta.pk, lectura__in=ABIERTAS)
        .update(
            lectura=Alerta.Lectura.REVISADA,
            revisada_en=ahora,
            leida_en=Coalesce("leida_en", Value(ahora)),
            actualizado_en=ahora,
            datos=datos,
        )
    )
    if cambiadas:
        log.info("alerta %s anulada: %s", alerta.pk, motivo)
    return bool(cambiadas)


def _corregir(alerta: Alerta, suscripcion: SuscripcionVigilada, *, ahora) -> bool:
    """Reescribe el texto de la alerta con el monto y el nombre de ahora.

    Solo se llama cuando la fecha NO cambió, así que la alerta sigue siendo
    cierta: lo único viejo es cuánto decía que se iba a cobrar. Se corrige en
    su lugar en vez de anularla, porque anularla la dejaría sin reemplazo (el
    `evento_id` determinístico no cambia si la fecha no cambia).
    """
    from . import generador  # import local: generador no importa de acá

    mensaje = generador.mensaje_de(alerta.tipo, suscripcion)
    if mensaje is None:
        return False
    datos = dict(alerta.datos or {})
    datos.update(
        {
            "monto": str(suscripcion.monto),
            "moneda": suscripcion.moneda,
            "corregida_en": ahora.isoformat(),
        }
    )
    cambiadas = (
        Alerta.objects.filter(pk=alerta.pk, lectura__in=ABIERTAS)
        .update(mensaje=mensaje, datos=datos, actualizado_en=ahora)
    )
    if cambiadas:
        log.info("alerta %s corregida: el monto o el nombre cambiaron", alerta.pk)
    return bool(cambiadas)


def _desactualizada(alerta: Alerta, suscripcion: SuscripcionVigilada) -> bool:
    """¿El texto de la alerta dice un monto, moneda o nombre que ya no es?

    Se compara contra lo que el generador ANOTÓ en `datos`, no contra el texto
    del mensaje. Preguntar si el nombre aparece dentro del mensaje falla en un
    caso real: si el nombre pasa de «Netflix Premium» a «Netflix», el mensaje
    viejo sigue conteniendo «Netflix» y la alerta se quedaría con el nombre
    viejo para siempre.

    Las alertas generadas antes de que `datos` llevara `nombre` no tienen esa
    llave; para esas se cae al texto, que es lo único que hay.
    """
    datos = alerta.datos or {}
    if datos.get("origen") != "generador":
        # No la escribió el generador: su texto no es nuestro y no se toca.
        return False
    if str(datos.get("monto", "")) != str(suscripcion.monto):
        return True
    if datos.get("moneda") != suscripcion.moneda:
        return True
    if "nombre" in datos:
        return datos["nombre"] != suscripcion.nombre
    return suscripcion.nombre not in (alerta.mensaje or "")


def revisar(
    suscripcion: SuscripcionVigilada, *, evento_id, ahora=None
) -> Resultado:
    """Juzga las alertas abiertas de una suscripción contra su estado de ahora.

    Se llama después de aplicar la proyección, dentro de la misma transacción.
    `evento_id` queda anotado en las que se anulan, para poder responder
    "¿por qué desapareció mi alerta?" sin adivinar.
    """
    ahora = ahora or timezone.now()
    resultado = Resultado()
    abiertas = Alerta.objects.filter(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion_id=suscripcion.suscripcion_id,
        lectura__in=ABIERTAS,
    )

    for alerta in abiertas:
        motivo = _motivo_para_anular(alerta, suscripcion)
        if motivo:
            if _anular(alerta, evento_id=evento_id, motivo=motivo, ahora=ahora):
                resultado.anuladas.append(alerta)
            continue
        if _desactualizada(alerta, suscripcion) and _corregir(
            alerta, suscripcion, ahora=ahora
        ):
            resultado.corregidas.append(alerta)
            continue
        resultado.intactas += 1
    return resultado


def _motivo_para_anular(
    alerta: Alerta, suscripcion: SuscripcionVigilada
) -> str | None:
    """El motivo por el que esta alerta ya no es cierta, o None si sigue siéndolo."""
    if not suscripcion.vigente:
        return f"la suscripción quedó en estado «{suscripcion.estado}»"

    if alerta.tipo in SOLO_EN_PRUEBA and suscripcion.estado != "prueba":
        return (
            f"el aviso es del período de prueba y la suscripción está "
            f"«{suscripcion.estado}»"
        )

    llaves = FECHA_POR_TIPO.get(alerta.tipo)
    if llaves is None:
        # Un tipo que no habla de una fecha de la suscripción (un presupuesto
        # excedido, un doble cobro). Mientras la suscripción esté vigente, el
        # hecho que anunció sigue habiendo pasado.
        return None

    llave_datos, campo = llaves
    afirmada = _fecha_afirmada(alerta, llave_datos)
    if afirmada is None:
        return None
    vigente = getattr(suscripcion, campo)
    if vigente is None:
        return f"la suscripción ya no tiene {campo.replace('_', ' ')}"
    if afirmada != vigente:
        return (
            f"anunciaba el {afirmada:%d-%m-%Y} y ahora es el {vigente:%d-%m-%Y}"
        )
    return None

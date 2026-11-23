"""S3-FE-22 — invalidar los avisos que dejaron de corresponder.

Un aviso de próximo cobro dice «el 1 de noviembre se cobran $9.990», y uno de
fin de prueba, «la prueba termina el 5». Los dos se calculan con la
suscripción de ESE momento (`generador.py`). Si después la fecha cambia o la
suscripción se cancela, el aviso viejo miente: no tiene que salir por correo
ni seguir en la campana.

    proyeccion.aplicar(evento)  ─▶  revisar(suscripcion)   en la misma transacción

── Cuándo un aviso queda obsoleto ────────────────────────────────────────
| Aviso | Queda obsoleto si | Motivo |
|---|---|---|
| próximo cobro | la suscripción ya no está vigente | `no_vigente` |
| próximo cobro | `proximo_cobro` ya no es la fecha del aviso | `cobro_cambiado` |
| fin de prueba | la suscripción ya no está en prueba | `prueba_terminada` |
| fin de prueba | `fin_prueba` ya no es la fecha del aviso | `prueba_cambiada` |

Los demás tipos (alza de tarifa, doble cobro, presupuesto) no dependen de una
fecha futura: cuentan algo que ya pasó, y siguen siendo ciertos.

Un aviso obsoleto:
- no se borra: queda con `invalidada_en` y su motivo, para que se vea qué pasó;
- sale de la campana y del listado (`views.py`);
- sus correos que todavía esperan turno pasan a `descartada`
  (`alerta_obsoleta`), y uno que se reclame después también se descarta
  (`entregas.reclamar`).

Un correo que ya estaba saliendo (`enviando`) cuando llegó el cambio no se
puede atajar: el proveedor ya lo tiene.

── Orden y eventos repetidos ─────────────────────────────────────────────
Esto corre SOLO cuando `aplicar` cambió la proyección. Un evento más viejo
que lo que ya se sabía, o uno repetido, no cambia nada y tampoco invalida ni
reactiva nada: «respetar versión y orden» es lo que ya hace `aplicar`.

Y un aviso obsoleto no se recrea. El generador arma el id de cada aviso con
la fecha (`id_de_ventana`): con la fecha nueva sale un aviso nuevo, y el de la
fecha vieja choca con su propio id y no vuelve.

── Si la fecha vuelve a la de antes ──────────────────────────────────────
Una fecha que se cambia y después se corrige de vuelta es posible. El aviso
de la fecha original quedó obsoleto, y el generador no puede crear otro
porque su id es el mismo. Si no se reactivara, ese cobro nunca se avisaría.
Por eso un aviso obsoleto por un cambio de fecha vuelve a valer cuando la
fecha vuelve a ser la suya, y sus correos descartados por obsoletos vuelven a
esperar turno. Uno obsoleto porque la suscripción dejó de estar vigente no
vuelve solo.
"""

from __future__ import annotations

import datetime as dt

from django.utils import timezone

from .models import Alerta, EntregaAlerta, SuscripcionVigilada

MOTIVO_ENTREGA = "alerta_obsoleta"

#: Los motivos de los que un aviso puede volver si la fecha vuelve a la suya.
_POR_CAMBIO_DE_FECHA = ("cobro_cambiado", "prueba_cambiada")


def _motivo(alerta: Alerta, suscripcion: SuscripcionVigilada) -> str:
    """Por qué el aviso ya no corresponde, o "" si sigue valiendo."""
    datos = alerta.datos or {}
    if alerta.tipo == Alerta.Tipo.PROXIMO_COBRO:
        if not suscripcion.vigente:
            return "no_vigente"
        if datos.get("fecha_cobro") != suscripcion.proximo_cobro.isoformat():
            return "cobro_cambiado"
        return ""
    if alerta.tipo == Alerta.Tipo.FIN_PRUEBA:
        if suscripcion.estado != "prueba":
            return "prueba_terminada"
        fin = suscripcion.fin_prueba.isoformat() if suscripcion.fin_prueba else None
        if datos.get("fin_prueba") != fin:
            return "prueba_cambiada"
        return ""
    return ""


def revisar(suscripcion: SuscripcionVigilada, *, ahora: dt.datetime | None = None) -> dict:
    """Invalida los avisos de la suscripción que dejaron de corresponder y
    reactiva los que vuelven a hacerlo. Devuelve cuántos de cada uno."""
    ahora = ahora or timezone.now()
    avisos = Alerta.objects.select_for_update().filter(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion_id=suscripcion.suscripcion_id,
        tipo__in=(Alerta.Tipo.PROXIMO_COBRO, Alerta.Tipo.FIN_PRUEBA),
    )
    invalidadas, reactivadas = [], []
    for alerta in avisos:
        motivo = _motivo(alerta, suscripcion)
        if motivo and alerta.invalidada_en is None:
            alerta.invalidada_en = ahora
            alerta.motivo_invalidacion = motivo
            alerta.save(update_fields=["invalidada_en", "motivo_invalidacion", "actualizado_en"])
            invalidadas.append(alerta.pk)
        elif not motivo and alerta.invalidada_en is not None and alerta.motivo_invalidacion in _POR_CAMBIO_DE_FECHA:
            alerta.invalidada_en = None
            alerta.motivo_invalidacion = ""
            alerta.save(update_fields=["invalidada_en", "motivo_invalidacion", "actualizado_en"])
            reactivadas.append(alerta.pk)

    descartadas = 0
    if invalidadas:
        descartadas = EntregaAlerta.objects.filter(
            alerta_id__in=invalidadas, estado__in=EntregaAlerta.EN_ESPERA,
        ).update(estado=EntregaAlerta.Estado.DESCARTADA, motivo=MOTIVO_ENTREGA, actualizado_en=ahora)
    devueltas = 0
    if reactivadas:
        devueltas = EntregaAlerta.objects.filter(
            alerta_id__in=reactivadas, estado=EntregaAlerta.Estado.DESCARTADA, motivo=MOTIVO_ENTREGA,
        ).update(estado=EntregaAlerta.Estado.PENDIENTE, motivo="", proximo_intento_en=ahora, actualizado_en=ahora)
    return {
        "invalidadas": len(invalidadas),
        "reactivadas": len(reactivadas),
        "entregas_descartadas": descartadas,
        "entregas_devueltas": devueltas,
    }

"""Aplicar una orden de cobro de connectors (RF-14 / RN-DAT-004).

Una persona confirmó en connectors un cobro candidato que salió de un CSV o
de un correo. connectors publica `candidato.confirmado` v1 (contrato en
`shared/contratos/candidato_confirmado.py`) y el consumidor de este servicio
llama a `aplicar`. Esto es lo que hace con ella, en UNA transacción:

    1. busca la suscripción de ese proveedor, o la crea;
    2. si el dinero ya salió (`crear_cobro`), registra el cobro… salvo que ya
       esté registrado por la OTRA fuente, y entonces se cuelga de ese;
    3. deja una fila en `CandidatoAplicado` con el origen y su identificador.

── El mismo cargo por las dos fuentes ───────────────────────────────────────
Netflix cobra 9.990 el 5 de noviembre. Llega el correo de Netflix y la
persona lo confirma; después sube la cartola, que trae la misma línea, y la
confirma también. Son dos candidatos distintos en connectors (orígenes e
identificadores distintos, así que su unicidad no los junta) y dos órdenes.
Sin nada más, quedarían dos cobros y el gasto del mes saldría al doble.

La regla para decir que son el mismo cargo:

  · la misma suscripción, el mismo importe exacto y la misma moneda;
  · fechas a menos de `DIAS_DOBLE_COBRO` (5) días: el correo llega el día
    del cobro y la cartola suele asentarlo uno a tres días después. Es la
    misma ventana con la que `anomalias.py` avisa un posible doble cobro,
    así que lo que acá se junta es exactamente lo que allá se avisaría;
  · y que ese cobro TODAVÍA NO tenga un origen de la misma fuente.

El último punto es el que impide tapar un doble cobro de verdad. Si la
cartola trae DOS líneas de 9.990 (Netflix cobró dos veces), la primera se
junta con el correo y la segunda encuentra que ese cobro ya tiene un origen
`csv`: no es el mismo, se registra aparte y `anomalias.py` levanta el
hallazgo de doble cobro, que es lo que tiene que pasar. Un cobro ingresado a
mano no tiene orígenes, así que también se junta con el primero que llegue.

Lo que NO se junta, a propósito: importes distintos (un cobro en USD que la
cartola muestra en CLP no se puede comparar sin un tipo de cambio que el
sistema no tiene) y fechas a 5 días o más. Ante la duda quedan dos cobros y
el aviso de doble cobro, que la persona puede revisar; juntar de más
borraría un cobro real sin que nadie lo vea.

── Qué se conserva (RN-DAT-004) ─────────────────────────────────────────────
Cada orden deja su fila, también la que se juntó: el cobro termina con un
`CandidatoAplicado` por fuente, cada uno con su identificador (la huella de
la línea de la cartola o el Message-ID), su fecha y su importe. Nada se
descarta.

── La suscripción ───────────────────────────────────────────────────────────
Se busca una suscripción vigente (`activo=True`) de la organización con la
misma moneda y el mismo proveedor (por catálogo, o por nombre si se creó a
mano sin proveedor). Si hay varias, la más antigua; una cancelada solo si no
hay otra, porque un cobro de una suscripción cancelada es justo lo que la
persona tiene que ver. Si no hay ninguna, se crea:

    nombre      el nombre canónico que reconoció connectors
    proveedor   el del catálogo con ese nombre, si existe
    monto       el importe de la orden
    frecuencia  mensual: un cobro suelto no dice el ciclo y casi todas lo son
    próximo     un mes después del cobro; en un aviso, la fecha avisada
    estado      activo; por_confirmar si lo único que se sabe es un pago fallido

No se cambia el estado de una suscripción que ya existía ni su próximo cobro:
registrar un cobro a mano tampoco lo hace, y las transiciones tienen sus
propias reglas de tiempo. La orden registra lo que pasó; no reinterpreta el
ciclo.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When

from shared.bloqueo import bloquear
from shared.borrado.bloqueo import bloquear_organizacion

from app.anomalias import DIAS_DOBLE_COBRO, _restar_meses
from app.models import CandidatoAplicado, Cobro, Proveedor, Subscription
from events.outbox import registrar_creada
from events.trabajo import HECHO_POR_CONSUMIDOR, OrganizacionEliminada, recalcular_resumen_por_evento

__all__ = ["Aplicacion", "OrganizacionEliminada", "aplicar"]


@dataclass(frozen=True)
class Aplicacion:
    """Qué quedó de una orden. `nueva=False` si ya estaba aplicada."""

    fila: CandidatoAplicado
    nueva: bool


def _suscripcion(organizacion_id, datos, importe: Decimal, fecha: date) -> tuple[Subscription, bool]:
    servicio = datos["servicio"]
    proveedor = Proveedor.objects.filter(nombre=servicio).first()
    coincide = Q(nombre__iexact=servicio)
    if proveedor is not None:
        coincide |= Q(proveedor=proveedor)
    existente = (
        Subscription.objects.select_for_update()
        .filter(coincide, organizacion_id=organizacion_id, activo=True, moneda=datos["moneda"])
        .annotate(
            cancelada=Case(
                When(estado=Subscription.Estado.CANCELADO, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
        )
        .order_by("cancelada", "creado_en", "id")
        .first()
    )
    if existente is not None:
        return existente, False

    tipo = datos["tipo_mensaje"]
    proximo = fecha if tipo == "aviso_de_cobro" else _restar_meses(fecha, -1)
    estado = Subscription.Estado.POR_CONFIRMAR if tipo == "pago_fallido" else Subscription.Estado.ACTIVO
    nueva = Subscription.objects.create(
        organizacion_id=organizacion_id,
        nombre=servicio,
        proveedor=proveedor,
        categoria=proveedor.categoria if proveedor is not None else "otro",
        monto=importe,
        moneda=datos["moneda"],
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=proximo,
        estado=estado,
    )
    return nueva, True


def mismo_cobro(suscripcion: Subscription, *, origen: str, importe: Decimal, moneda: str, fecha: date) -> Cobro | None:
    """El cobro ya registrado que es este mismo cargo, o None. Ver el docstring."""
    margen = DIAS_DOBLE_COBRO - 1
    # Sin FOR UPDATE: lo que serializa es el lock `ordenes_de_cobro` que
    # `aplicar` ya tomó. Una orden no compite con otra por el mismo cobro.
    posibles = (
        Cobro.objects.filter(
            suscripcion=suscripcion,
            monto=importe,
            moneda=moneda,
            fecha__range=(_sumar_dias(fecha, -margen), _sumar_dias(fecha, margen)),
        )
        .exclude(origenes__origen=origen)
        .order_by("fecha", "id")
    )
    # El más cercano en fecha; a igual distancia, el más antiguo.
    return min(posibles, key=lambda c: (abs((c.fecha - fecha).days), c.fecha, str(c.id)), default=None)


def _sumar_dias(fecha: date, dias: int) -> date:
    return date.fromordinal(fecha.toordinal() + dias)


def aplicar(sobre: dict) -> Aplicacion:
    """Aplica un sobre YA VALIDADO contra el contrato. Idempotente.

    Lanza `OrganizacionEliminada` si la organización se borró (la entrega
    quedó obsoleta: se confirma sin hacer nada), y `ValidationError` si el
    catálogo no admite la moneda (eso no mejora reintentando).
    """
    datos = sobre["datos"]
    organizacion_id = uuid.UUID(sobre["organizacion_id"])
    candidato_id = uuid.UUID(datos["candidato_id"])
    importe = Decimal(datos["importe"])
    fecha = date.fromisoformat(datos["fecha"])

    with transaction.atomic():
        # La limpieza de MX-07 toma este mismo bloqueo en exclusivo: o la orden
        # termina antes del borrado, o ve la marca y no escribe nada.
        estado = bloquear_organizacion(organizacion_id, compartido=True)
        if estado.eliminada:
            raise OrganizacionEliminada()
        # Las órdenes de una misma organización, de a una. Sin esto, el correo
        # y la cartola del mismo cargo procesados a la vez no se verían entre
        # sí y quedarían dos cobros: es justo el caso que esto resuelve.
        bloquear("ordenes_de_cobro", organizacion_id)

        previa = CandidatoAplicado.objects.filter(
            Q(candidato_id=candidato_id)
            | Q(origen=datos["origen"], identificador_origen=datos["identificador_origen"]),
            organizacion_id=organizacion_id,
        ).first()
        if previa is not None:
            return Aplicacion(previa, nueva=False)

        suscripcion, creada = _suscripcion(organizacion_id, datos, importe, fecha)

        cobro = None
        resultado = CandidatoAplicado.Resultado.SIN_COBRO
        if datos["crear_cobro"]:
            cobro = mismo_cobro(
                suscripcion, origen=datos["origen"], importe=importe, moneda=datos["moneda"], fecha=fecha
            )
            if cobro is not None:
                resultado = CandidatoAplicado.Resultado.COBRO_EXISTENTE
            else:
                # La señal post_save corre la detección de anomalías dentro de
                # esta misma transacción, igual que al registrarlo a mano.
                cobro = Cobro.objects.create(
                    organizacion_id=organizacion_id,
                    suscripcion=suscripcion,
                    monto=importe,
                    moneda=datos["moneda"],
                    fecha=fecha,
                )
                resultado = CandidatoAplicado.Resultado.COBRO_CREADO

        fila = CandidatoAplicado.objects.create(
            organizacion_id=organizacion_id,
            evento_id=uuid.UUID(sobre["id"]),
            candidato_id=candidato_id,
            origen=datos["origen"],
            identificador_origen=datos["identificador_origen"],
            tipo_mensaje=datos["tipo_mensaje"],
            fecha=fecha,
            importe=importe,
            moneda=datos["moneda"],
            suscripcion=suscripcion,
            cobro=cobro,
            suscripcion_creada=creada,
            resultado=resultado,
        )

        if creada:
            # Lo mismo que hace el POST de una suscripción: el hecho va al
            # outbox (analytics y notifications lo escuchan) y el resumen se
            # recalcula acá, acreditado contra ese evento, así que cuando el
            # consumidor reciba `suscripcion.creada` lo encuentra hecho.
            evento = registrar_creada(suscripcion, correlation_id=sobre["correlation_id"])
            recalcular_resumen_por_evento(evento.id, organizacion_id, hecho_por=HECHO_POR_CONSUMIDOR)

    return Aplicacion(fila, nueva=True)

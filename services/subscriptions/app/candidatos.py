"""Aplicar una orden de cobro de connectors (RF-14 / RN-DAT-004).

Una persona confirmó en connectors un cobro candidato que salió de un CSV o
de un correo. connectors publica `candidato.confirmado` v1 (contrato en
`shared/contratos/candidato_confirmado.py`) y el consumidor de este servicio
llama a `aplicar`. Esto es lo que hace con ella, en UNA transacción:

    1. busca la suscripción de ese proveedor, o la crea;
    2. si el dinero ya salió (`crear_cobro`), registra el cobro;
    3. si la suscripción estaba cancelada o por confirmar y este es un pago
       NUEVO, hace la transición de RF-03 que corresponde;
    4. deja una fila en `CandidatoAplicado` con el origen y su identificador;
    5. deja en el outbox la respuesta `candidato.aplicado` para connectors.

── El mismo cargo por las dos fuentes: se ve y se resuelve, no se adivina ────
Netflix cobra 9.990 el 5 de noviembre. Llega el correo y la persona lo
confirma; después sube la cartola, que trae la misma línea, y la confirma
también. Son dos candidatos distintos en connectors (orígenes e
identificadores distintos) y dos órdenes.

Las dos primeras versiones juntaban acá el segundo con el primero: primero
con 4 días de margen, después solo el mismo día. Las dos revisiones de #242
mostraron el problema de fondo: **fecha, importe y moneda iguales no prueban
que sea el mismo cargo.** Dos meses del mismo plan pagados el mismo día, o
dos cuentas de la familia, dan exactamente eso. Juntarlos en silencio
esconde plata que salió, y RF-07 pide lo contrario.

Así que esto NO decide. Cada orden con cobro registra su cobro, con su
origen, y la señal de `Cobro` corre `anomalias.py`, que levanta el hallazgo
de posible doble cobro (otro cobro de la suscripción a menos de 5 días; el
mismo día incluido). La persona lo resuelve explícitamente:

    POST /api/hallazgos/<id>/conciliar/   «es el mismo cargo»: queda UN
                                          cobro, con los dos orígenes
    POST /api/hallazgos/<id>/revisar/     «son dos cargos»: quedan los dos

Hasta que lo resuelva, los dos cobros cuentan: es lo que dicen los datos, y
el hallazgo avisa que puede sobrar uno. Ver `anomalias.conciliar_doble_cobro`.

El caso inverso sale igual: el mismo cargo con fecha distinta en cada fuente
(el correo del 01-11 y la cartola que lo asienta el 03-11) también queda en
dos cobros con su hallazgo, y se concilia igual.

── Qué se conserva (RN-DAT-004) ─────────────────────────────────────────────
Cada orden deja su fila con el origen, el identificador (la huella de la
línea de la cartola o el Message-ID), la fecha y el importe que dijo ESE
origen. Conciliar mueve la fila al cobro que queda; no se borra ninguna.

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

── El estado de una suscripción que ya existía (RF-03) ──────────────────────
No se cambia su próximo cobro (registrar un cobro a mano tampoco lo hace). El
estado cambia solo con un PAGO NUEVO, y con la transición que RF-03 ya tiene
para eso, así queda su auditoría y su evento:

    cancelado      → activo   `cobro_nuevo_detectado`: la siguen cobrando
    por_confirmar  → activo   `cobro_regularizado`: el pago volvió a pasar

«Pago nuevo» quiere decir las tres cosas a la vez:

  · es un `cobro_realizado`: un aviso o un pago fallido no son plata que
    salió (y un fallido es justo lo que la tiene por confirmar);
  · su fecha es POSTERIOR al día en que la suscripción entró a ese estado
    (la última transición hacia él, o su creación si nació así). Un cobro de
    antes, o del mismo día, es historia: puede ser justamente el que falló;
  · no es una reentrega: esa ya estaba aplicada y no hace nada.

Los demás estados no se tocan: `prueba` termina con su propia regla de fecha
y `fantasma` sale por uso, no por cobro.

── El importe ───────────────────────────────────────────────────────────────
`Cobro.monto` y `Subscription.monto` son NUMERIC(10,2). El contrato admite
exactamente ese rango (`candidato_confirmado.IMPORTE_MAXIMO`) y connectors
rechaza al confirmar un candidato que lo supere, así que una orden aceptada
siempre cabe. `test_el_rango_del_contrato_es_el_de_las_columnas` lo amarra.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.utils import timezone

from shared.bloqueo import bloquear
from shared.borrado.bloqueo import bloquear_organizacion
from shared.contratos import candidato_aplicado

from app.anomalias import _restar_meses
from app.models import CandidatoAplicado, Cobro, Proveedor, Subscription
from events.ordenes import registrar_resultado, ya_contestada
from events.outbox import registrar_creada
from events.trabajo import HECHO_POR_CONSUMIDOR, OrganizacionEliminada, recalcular_resumen_por_evento

__all__ = ["Aplicacion", "OrganizacionEliminada", "aplicar", "registrar_fallo"]


@dataclass(frozen=True)
class Aplicacion:
    """Qué quedó de una orden. `nueva=False` si ya estaba aplicada."""

    fila: CandidatoAplicado
    nueva: bool


#: Qué transición de RF-03 hace un pago nuevo según el estado en que esté.
#: Ver «El estado de una suscripción que ya existía» en el docstring.
TRANSICION_POR_PAGO_NUEVO = {
    Subscription.Estado.CANCELADO: Subscription.EventoEstado.COBRO_NUEVO_DETECTADO,
    Subscription.Estado.POR_CONFIRMAR: Subscription.EventoEstado.COBRO_REGULARIZADO,
}


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


def _transicion_por_pago_nuevo(suscripcion: Subscription, fecha_cobro: date, correlation_id) -> bool:
    """La transición de RF-03 que corresponde a un pago nuevo, si corresponde."""
    evento = TRANSICION_POR_PAGO_NUEVO.get(suscripcion.estado)
    if evento is None:
        return False
    entro_en = (
        suscripcion.transiciones_estado.filter(estado_nuevo=suscripcion.estado)
        .order_by("-ocurrido_en")
        .values_list("ocurrido_en", flat=True)
        .first()
    )
    # Sin transición registrada (nació en ese estado), lo único que se sabe es
    # cuándo se creó: un cobro de ese día o anterior es historia.
    desde = timezone.localtime(entro_en or suscripcion.creado_en).date()
    if fecha_cobro <= desde:
        return False
    suscripcion.transicionar(evento, actor_rol="sistema", correlation_id=correlation_id)
    return True


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
        # Las órdenes de una misma organización, de a una. Sin esto, dos
        # órdenes del mismo proveedor procesadas a la vez no se verían entre
        # sí y crearían DOS suscripciones (el FOR UPDATE de `_suscripcion` no
        # bloquea una fila que todavía no existe).
        bloquear("ordenes_de_cobro", organizacion_id)

        previa = CandidatoAplicado.objects.filter(
            Q(candidato_id=candidato_id)
            | Q(origen=datos["origen"], identificador_origen=datos["identificador_origen"]),
            organizacion_id=organizacion_id,
        ).first()
        if previa is not None:
            # Reentrega: ya está aplicada y su respuesta ya está en el outbox.
            return Aplicacion(previa, nueva=False)

        suscripcion, creada = _suscripcion(organizacion_id, datos, importe, fecha)

        cobro = None
        resultado = CandidatoAplicado.Resultado.SIN_COBRO
        if datos["crear_cobro"]:
            # La señal post_save corre la detección de anomalías dentro de
            # esta misma transacción, igual que al registrarlo a mano: si ya
            # había un cobro a menos de 5 días, sale el posible doble cobro.
            cobro = Cobro.objects.create(
                organizacion_id=organizacion_id,
                suscripcion=suscripcion,
                monto=importe,
                moneda=datos["moneda"],
                fecha=fecha,
            )
            resultado = CandidatoAplicado.Resultado.COBRO_CREADO
            if not creada:
                _transicion_por_pago_nuevo(suscripcion, fecha, sobre["correlation_id"])

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

        # La respuesta para connectors, en esta misma transacción: no hay
        # orden aplicada sin respuesta ni respuesta de algo que no quedó.
        registrar_resultado(
            organizacion_id=organizacion_id,
            correlation_id=sobre["correlation_id"],
            candidato_id=candidato_id,
            orden_id=sobre["id"],
            resultado=candidato_aplicado.APLICADO,
            motivo=(
                candidato_aplicado.COBRO_CREADO
                if resultado == CandidatoAplicado.Resultado.COBRO_CREADO
                else candidato_aplicado.SIN_COBRO
            ),
            suscripcion_id=suscripcion.id,
            cobro_id=cobro.id if cobro is not None else None,
        )

    return Aplicacion(fila, nueva=True)


def registrar_fallo(sobre, *, motivo: str) -> bool:
    """Contesta `fallido` a una orden que se va a la cola de fallos.

    Corre en su propia transacción: lo que falló ya se deshizo. Devuelve
    `False` sin escribir nada si el sobre no trae con qué correlacionar (sin
    organización ni candidato no hay a quién contestarle), si la organización
    se borró, o si esa orden ya tenía respuesta (una reentrega que vuelve a
    fallar no contesta dos veces).
    """
    try:
        organizacion_id = uuid.UUID(str(sobre["organizacion_id"]))
        candidato_id = uuid.UUID(str(sobre["datos"]["candidato_id"]))
        orden_id = uuid.UUID(str(sobre["id"]))
        correlation_id = uuid.UUID(str(sobre["correlation_id"]))
    except (KeyError, TypeError, ValueError, AttributeError):
        return False

    with transaction.atomic():
        estado = bloquear_organizacion(organizacion_id, compartido=True)
        if estado.eliminada:
            return False
        bloquear("ordenes_de_cobro", organizacion_id)
        if ya_contestada(organizacion_id, candidato_id):
            return False
        registrar_resultado(
            organizacion_id=organizacion_id,
            correlation_id=correlation_id,
            candidato_id=candidato_id,
            orden_id=orden_id,
            resultado=candidato_aplicado.FALLIDO,
            motivo=motivo,
        )
    return True

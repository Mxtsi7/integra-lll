"""El trabajo derivado: lo que hay que hacer *después* de que algo pasó.

Esto es lo único que se mueve entre los dos modos. No cambia según la
bandera: lo mismo se ejecuta dentro del POST o detrás de la cola. Si cambiara,
la comparación no mediría nada.

Es idempotente a propósito: recalcular dos veces da el mismo resultado. El
catálogo (shared/events/catalogo.md, regla 1) exige que los consumidores lo
sean, porque RabbitMQ garantiza *al menos una* entrega, no *exactamente una*.
"""

from decimal import Decimal

from django.db import transaction
from django.db.models import Case, Count, DecimalField, F, Sum, When
from rest_framework.exceptions import PermissionDenied

from shared.bloqueo import bloquear
from shared.borrado.bloqueo import bloquear_organizacion

from app.models import ResumenOrganizacion, Subscription, TrabajoDerivado

#: Quién hizo el trabajo, para la evidencia.
HECHO_POR_API = "api"
HECHO_POR_CONSUMIDOR = "consumidor"


class OrganizacionEliminada(PermissionDenied):
    """El trabajo quedó obsoleto por el borrado, sin acreditar un recálculo."""

    default_detail = "La organización fue eliminada"


def ya_acreditado(evento_id) -> bool:
    """Si el resumen de ESTE evento ya se recalculó (por quien sea)."""
    return TrabajoDerivado.objects.filter(
        evento_id=evento_id, trabajo=TrabajoDerivado.Trabajo.RESUMEN
    ).exists()


def recalcular_resumen_por_evento(evento_id, organizacion_id, *, hecho_por: str) -> bool:
    """Hace el trabajo de un evento, salvo que ya esté acreditado. True si lo hizo.

    OrganizacionEliminada señala una entrega obsoleta: no recalcula ni acredita.

    ── La evidencia va en la MISMA transacción que el trabajo ─────────────
    O quedan las dos cosas, o ninguna. Si el recálculo falla no queda una
    fila diciendo que se hizo; si el acreditar falla, el recálculo se
    deshace y la reentrega vuelve a encontrar el trabajo pendiente.

    Esto es lo que mira el consumidor en vez de su bandera: la primera
    versión confirmaba sin recalcular cuando `EVENTOS_ASINCRONOS=0`, y un
    evento producido en asíncrono —sin resumen— que llegaba con la bandera
    en 0 se perdía con ACK. La bandera del proceso que consume no demuestra
    lo que hizo el proceso que produjo; esta fila sí. Lo reprodujo la
    revisión de la PR.

    `get_or_create` y no `create`: si dos consumidores reciben la misma
    entrega, los dos recalculan (es idempotente) y el segundo encuentra la
    fila del primero en vez de reventar con la restricción única.
    """
    with transaction.atomic():
        # La limpieza toma FOR UPDATE: espera hasta confirmar trabajo y evidencia.
        estado = bloquear_organizacion(organizacion_id, compartido=True)
        if estado.eliminada:
            raise OrganizacionEliminada()
        if ya_acreditado(evento_id):
            return False
        recalcular_resumen(organizacion_id)
        TrabajoDerivado.objects.get_or_create(
            evento_id=evento_id,
            trabajo=TrabajoDerivado.Trabajo.RESUMEN,
            defaults={"organizacion_id": organizacion_id, "hecho_por": hecho_por},
        )
    return True


def recalcular_resumen(organizacion_id) -> list[ResumenOrganizacion]:
    """Recalcula el gasto mensual de una organización, una fila por moneda.

    ── Por qué por moneda y no un total ─────────────────────────────────────
    La versión anterior sumaba `monto` de todas las suscripciones sin mirar la
    divisa: 10.000 CLP más 10 USD mensuales daban `total_mensual = 10010`, que
    no es plata de ninguna moneda. El error se vio recién en la revisión.

    Convertir a una divisa base exigiría una fuente de tipos de cambio que el
    sistema no tiene, y meter una tasa fija en el código sería inventar datos
    financieros. Así que cada moneda se informa por separado y quien arme el
    panel decide cómo presentarlas.

    Las anuales se dividen por 12 para dejarlas comparables con las mensuales,
    dentro de su propia moneda.

    Devuelve las filas vigentes. Las monedas que la organización dejó de usar
    se borran, para que no queden totales fantasma de una divisa sin
    suscripciones. Lanza OrganizacionEliminada si el tenant ya fue borrado.
    """
    # ── El atomic empieza ANTES de leer, y lo primero es el lock ──────────
    # La versión anterior construía el queryset acá y abría el atomic recién
    # para escribir. Las escrituras quedaban agrupadas, pero la LECTURA no
    # estaba serializada: con read committed, otro recálculo podía confirmar
    # entre nuestro SUM y nuestro UPDATE, y el nuestro pisaba su resultado con
    # un total viejo. Reproducido en la revisión de la PR: fuente 120,
    # agregado 100.
    #
    # El modo síncrono corre desde varios workers a la vez, así que no es
    # hipotético. Y no se arregla solo porque después exista el outbox: el
    # modo síncrono no debería depender de que la cola lo corrija.
    with transaction.atomic():
        estado = bloquear_organizacion(organizacion_id, compartido=True)
        if estado.eliminada:
            raise OrganizacionEliminada()
        bloquear("resumen_organizacion", organizacion_id)
        return _recalcular_ya_bloqueado(organizacion_id)


def _recalcular_ya_bloqueado(organizacion_id) -> list[ResumenOrganizacion]:
    """El cálculo en sí. Asume que el lock de la organización ya está tomado."""
    activas = Subscription.objects.filter(
        organizacion_id=organizacion_id,
        activo=True,
        estado=Subscription.Estado.ACTIVO,
    )
    por_moneda = (
        activas.values("moneda")
        .annotate(
            total=Sum(
                Case(
                    When(
                        frecuencia=Subscription.Frecuencia.ANUAL,
                        then=F("monto") / Decimal("12"),
                    ),
                    default=F("monto"),
                    output_field=DecimalField(max_digits=12, decimal_places=2),
                )
            ),
            cantidad=Count("id"),
        )
        .order_by("moneda")
    )

    # Ya estamos dentro del atomic del llamador, que abarca la lectura: si
    # algo falla, no queda media organización recalculada con monedas de dos
    # momentos distintos.
    resumenes = []
    monedas_vigentes = []
    for fila in por_moneda:
        resumen, _ = ResumenOrganizacion.objects.update_or_create(
            organizacion_id=organizacion_id,
            moneda=fila["moneda"],
            defaults={
                "total_mensual": fila["total"] or Decimal("0"),
                "cantidad_activas": fila["cantidad"] or 0,
            },
        )
        resumenes.append(resumen)
        monedas_vigentes.append(fila["moneda"])

    # Las monedas que la organización dejó de usar se borran DENTRO del mismo
    # lock, o un recálculo concurrente podría reinsertarlas en el intervalo.
    ResumenOrganizacion.objects.filter(
        organizacion_id=organizacion_id
    ).exclude(moneda__in=monedas_vigentes).delete()

    return resumenes

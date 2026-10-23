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

from app.models import ResumenOrganizacion, Subscription


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
    suscripciones.
    """
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

    # En una sola transacción: si algo falla, no queda media organización
    # recalculada con monedas de dos momentos distintos.
    with transaction.atomic():
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

        ResumenOrganizacion.objects.filter(
            organizacion_id=organizacion_id
        ).exclude(moneda__in=monedas_vigentes).delete()

    return resumenes

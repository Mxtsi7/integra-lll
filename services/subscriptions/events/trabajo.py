"""El trabajo derivado: lo que hay que hacer *después* de que algo pasó.

Esto es lo único que se mueve entre los dos modos. No cambia según la
bandera: lo mismo se ejecuta dentro del POST o detrás de la cola. Si cambiara,
la comparación no mediría nada.

Es idempotente a propósito: recalcular dos veces da el mismo resultado. El
catálogo (shared/events/catalogo.md, regla 1) exige que los consumidores lo
sean, porque RabbitMQ garantiza *al menos una* entrega, no *exactamente una*.
"""

from decimal import Decimal

from django.db.models import Case, Count, DecimalField, F, Sum, When

from app.models import ResumenOrganizacion, Subscription


def recalcular_resumen(organizacion_id) -> ResumenOrganizacion:
    """Recalcula el gasto mensual de una organización y lo guarda.

    Las anuales se dividen por 12 para dejarlas comparables con las mensuales.
    El costo crece con la cantidad de suscripciones de la organización, que es
    justamente lo que hace visible la diferencia entre los dos modos.
    """
    activas = Subscription.objects.filter(
        organizacion_id=organizacion_id,
        activo=True,
        estado=Subscription.Estado.ACTIVO,
    )
    agregado = activas.aggregate(
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
    resumen, _ = ResumenOrganizacion.objects.update_or_create(
        organizacion_id=organizacion_id,
        defaults={
            "total_mensual": agregado["total"] or Decimal("0"),
            "cantidad_activas": agregado["cantidad"] or 0,
        },
    )
    return resumen

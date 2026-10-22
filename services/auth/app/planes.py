"""El plan pertenece a la organización; el navegador nunca lo concede."""
import calendar
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .models import Contratacion, Organizacion


def plan_vigente(organizacion_id, *, ahora=None):
    ahora = ahora or timezone.now()
    if not organizacion_id:
        return "free"
    pagada = Contratacion.objects.filter(
        organizacion_id=organizacion_id, plan_id="premium",
        estado__in=[Contratacion.Estado.EXITOSA, Contratacion.Estado.CANCELADA],
        vigente_desde__lte=ahora, vigente_hasta__gt=ahora,
    ).exists()
    return "premium" if pagada else "free"


def sumar_mes(instante):
    mes = instante.month % 12 + 1
    anio = instante.year + (instante.month == 12)
    return instante.replace(year=anio, month=mes, day=min(instante.day, calendar.monthrange(anio, mes)[1]))


@transaction.atomic
def transicionar(contratacion_id, estado, *, ahora=None):
    # El mismo bloqueo serializa inicios y confirmaciones de una organización.
    org_id = Contratacion.objects.values_list("organizacion_id", flat=True).get(pk=contratacion_id)
    Organizacion.objects.select_for_update().get(pk=org_id)
    contrato = Contratacion.objects.select_for_update().get(pk=contratacion_id)
    if contrato.estado == estado:
        return contrato
    destinos = {
        "pendiente": {"exitosa", "cancelada", "fallida"},
        "exitosa": {"cancelada"}, "cancelada": set(), "fallida": set(),
    }
    if estado not in destinos.get(contrato.estado, set()):
        raise ValidationError({"estado": "La transición de contratación no es válida."})
    ahora = ahora or timezone.now()
    if estado == Contratacion.Estado.EXITOSA:
        ultimo = Contratacion.objects.filter(
            organizacion_id=org_id, plan_id="premium",
            estado__in=["exitosa", "cancelada"], vigente_hasta__gt=ahora,
        ).order_by("-vigente_hasta").first()
        contrato.vigente_desde = ultimo.vigente_hasta if ultimo else ahora
        contrato.vigente_hasta = sumar_mes(contrato.vigente_desde)
    contrato.estado = estado
    contrato.save(update_fields=["estado", "vigente_desde", "vigente_hasta", "actualizado_en"])
    return contrato

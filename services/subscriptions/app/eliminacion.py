from django.db.models import Q
from rest_framework.response import Response

from shared.eliminacion import LimpiezaOrganizacionView
from .models import (
    CandidatoAplicado, Cobro, ConsentimientoRecolector, EventoUsoRecibido, HallazgoCobro, OutboxEvento, Presupuesto,
    ProyeccionUsoRecolector, RegistroUso, ResumenOrganizacion, Subscription,
    TrabajoDerivado, TransicionEstado,
)


class LimpiezaSubscriptionsView(LimpiezaOrganizacionView):
    servicio = "subscriptions"
    modelos = (
        # CandidatoAplicado (RF-14) antes que Cobro y Subscription: las apunta.
        OutboxEvento, Presupuesto, HallazgoCobro, CandidatoAplicado, Cobro, ConsentimientoRecolector, EventoUsoRecibido,
        ProyeccionUsoRecolector, RegistroUso, TransicionEstado,
        TrabajoDerivado, ResumenOrganizacion, Subscription,
    )

    def validar_limpieza(self, organizacion_id):
        # Una FK local inconsistente no autoriza borrar registros de otro tenant.
        if HallazgoCobro.objects.filter(
            Q(suscripcion__organizacion_id=organizacion_id)
            | Q(cobro__organizacion_id=organizacion_id)
            | Q(cobro_relacionado__organizacion_id=organizacion_id),
        ).exclude(organizacion_id=organizacion_id).exists():
            return Response({"code": "datos_tenant_inconsistentes"}, status=409)
        if CandidatoAplicado.objects.filter(
            Q(suscripcion__organizacion_id=organizacion_id) | Q(cobro__organizacion_id=organizacion_id),
        ).exclude(organizacion_id=organizacion_id).exists():
            return Response({"code": "datos_tenant_inconsistentes"}, status=409)
        for modelo in (Cobro, ConsentimientoRecolector, EventoUsoRecibido, ProyeccionUsoRecolector, RegistroUso, TransicionEstado):
            if modelo.objects.filter(suscripcion__organizacion_id=organizacion_id).exclude(
                organizacion_id=organizacion_id,
            ).exists():
                return Response({"code": "datos_tenant_inconsistentes"}, status=409)

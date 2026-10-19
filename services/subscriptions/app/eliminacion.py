from rest_framework.response import Response

from shared.eliminacion import LimpiezaOrganizacionView
from .models import Cobro, RegistroUso, Subscription


class LimpiezaSubscriptionsView(LimpiezaOrganizacionView):
    servicio = "subscriptions"
    modelos = (Cobro, RegistroUso, Subscription)

    def validar_limpieza(self, organizacion_id):
        # Una FK local inconsistente no autoriza borrar registros de otro tenant.
        for modelo in (Cobro, RegistroUso):
            if modelo.objects.filter(suscripcion__organizacion_id=organizacion_id).exclude(
                organizacion_id=organizacion_id,
            ).exists():
                return Response({"code": "datos_tenant_inconsistentes"}, status=409)

from rest_framework.response import Response

from shared.eliminacion import LimpiezaOrganizacionView
from .models import AutorizacionPendiente, CuentaConectada, Importacion


class LimpiezaConnectorsView(LimpiezaOrganizacionView):
    servicio = "connectors"
    modelos = (AutorizacionPendiente, Importacion, CuentaConectada)

    def validar_limpieza(self, organizacion_id):
        # SET_NULL tampoco debe modificar una importación de otro tenant.
        if Importacion.objects.filter(cuenta__organizacion_id=organizacion_id).exclude(
            organizacion_id=organizacion_id,
        ).exists():
            return Response({"code": "datos_tenant_inconsistentes"}, status=409)
        cuentas = CuentaConectada.objects.filter(organizacion_id=organizacion_id)
        # La evidencia la registra el adaptador FE-05. Conservar los tokens
        # mientras falte esa confirmación permite reintentar la revocación.
        cuentas.update(estado=CuentaConectada.Estado.DESCONECTADA)
        if cuentas.exclude(proveedor=CuentaConectada.Proveedor.CSV).filter(
            revocado_en__isnull=True,
        ).exists():
            return Response({"code": "revocacion_proveedor_pendiente"}, status=409)

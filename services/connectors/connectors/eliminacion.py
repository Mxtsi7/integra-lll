from rest_framework.response import Response

from shared.eliminacion import LimpiezaOrganizacionView
from .models import CuentaConectada


class LimpiezaConnectorsView(LimpiezaOrganizacionView):
    servicio = "connectors"
    modelos = (CuentaConectada,)

    def validar_limpieza(self, organizacion_id):
        cuentas = CuentaConectada.objects.filter(organizacion_id=organizacion_id)
        # Desconectar primero evita nuevas sincronizaciones. FE-05 aún no tiene
        # adaptador de revocación: conservar tokens cifrados permite recuperarla.
        cuentas.update(estado=CuentaConectada.Estado.DESCONECTADA)
        if cuentas.exclude(proveedor=CuentaConectada.Proveedor.CSV).filter(
            revocado_en__isnull=True,
        ).exists():
            return Response({"code": "revocacion_proveedor_pendiente"}, status=409)

from django.db import transaction
from rest_framework.response import Response

from shared.borrado.bloqueo import bloquear_organizacion
from shared.eliminacion import LimpiezaOrganizacionView
from .models import AutorizacionPendiente, CuentaConectada, Importacion
from .revocacion import revocar_y_desconectar


class LimpiezaConnectorsView(LimpiezaOrganizacionView):
    servicio = "connectors"
    modelos = (AutorizacionPendiente, Importacion, CuentaConectada)

    def _tenant_inconsistente(self, organizacion_id):
        return Importacion.objects.filter(cuenta__organizacion_id=organizacion_id).exclude(
            organizacion_id=organizacion_id,
        ).exists()

    def preparar_limpieza(self, organizacion_id):
        # La confirmación externa no puede deshacerse. Conservar cada éxito
        # aunque otra cuenta bloquee la limpieza o se pierda la respuesta HTTP.
        with transaction.atomic():
            bloquear_organizacion(organizacion_id)
            if self._tenant_inconsistente(organizacion_id):
                return Response({"code": "datos_tenant_inconsistentes"}, status=409)
            cuentas = CuentaConectada.objects.filter(
                organizacion_id=organizacion_id, revocado_en__isnull=True,
            ).exclude(proveedor=CuentaConectada.Proveedor.CSV)
            for cuenta in cuentas:
                with transaction.atomic():
                    resultado = revocar_y_desconectar(cuenta)
                    if not resultado.confirmada or resultado.reconectada_mientras_tanto:
                        # Un fallo conserva estado y credenciales para reintentar.
                        # Outlook sigue pendiente: no se inventa revocado_en.
                        transaction.set_rollback(True)

    def validar_limpieza(self, organizacion_id):
        if self._tenant_inconsistente(organizacion_id):
            return Response({"code": "datos_tenant_inconsistentes"}, status=409)
        if CuentaConectada.objects.filter(
            organizacion_id=organizacion_id, revocado_en__isnull=True,
        ).exclude(proveedor=CuentaConectada.Proveedor.CSV).exists():
            return Response({"code": "revocacion_proveedor_pendiente"}, status=409)

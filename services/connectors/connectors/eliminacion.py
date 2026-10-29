import logging

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from shared.borrado.bloqueo import bloquear_organizacion
from shared.eliminacion import LimpiezaOrganizacionView
from . import proveedores
from .models import AutorizacionPendiente, CuentaConectada, Importacion
from .revocacion import revocar_y_desconectar

logger = logging.getLogger(__name__)


class LimpiezaConnectorsView(LimpiezaOrganizacionView):
    servicio = "connectors"
    modelos = (AutorizacionPendiente, Importacion, CuentaConectada)

    def _tenant_inconsistente(self, organizacion_id):
        return Importacion.objects.filter(cuenta__organizacion_id=organizacion_id).exclude(
            organizacion_id=organizacion_id,
        ).exists()

    @extend_schema(exclude=True)
    def delete(self, request, organizacion_id):
        # `validar_limpieza` deja acá las cuentas que se cierran sin revocación
        # del proveedor. Se registra después del 204, no antes: un 409 no debe
        # dejar un log que diga que la organización se limpió.
        self._cuentas_sin_revocacion = 0
        self._proveedores_sin_revocacion = []
        respuesta = super().delete(request, organizacion_id)
        if respuesta.status_code == 204 and self._cuentas_sin_revocacion:
            logger.info(
                "limpieza_connectors_sin_revocacion_proveedor",
                extra={
                    "organizacion_id": str(organizacion_id),
                    "cuentas_sin_revocacion": self._cuentas_sin_revocacion,
                    "proveedores_sin_revocacion": self._proveedores_sin_revocacion,
                },
            )
        return respuesta

    def preparar_limpieza(self, organizacion_id):
        # La confirmación externa no puede deshacerse. Conservar cada éxito
        # aunque otra cuenta bloquee la limpieza o se pierda la respuesta HTTP.
        with transaction.atomic():
            bloquear_organizacion(organizacion_id)
            if self._tenant_inconsistente(organizacion_id):
                return Response({"code": "datos_tenant_inconsistentes"}, status=409)
            self._versiones_preparadas = dict(CuentaConectada.objects.filter(
                organizacion_id=organizacion_id,
            ).values_list("pk", "credenciales_version"))
            cuentas = CuentaConectada.objects.filter(
                organizacion_id=organizacion_id, revocado_en__isnull=True,
            ).exclude(proveedor=CuentaConectada.Proveedor.CSV)
            for cuenta in cuentas:
                if not proveedores.soporta_revocacion(cuenta.proveedor):
                    # Outlook: no hay revocación que intentar. No se toca nada
                    # acá; sus credenciales se destruyen con la fila en el
                    # borrado final, después de validar toda la organización.
                    continue
                try:
                    proveedores.configuracion_de(cuenta.proveedor)
                except proveedores.ProveedorNoSoportado:
                    # Proveedor desconocido: no hay forma segura de revocar.
                    # El validador lo bloqueará y no se destruyen credenciales
                    # en una ruta que termina en 409.
                    continue
                with transaction.atomic():
                    resultado = revocar_y_desconectar(cuenta)
                    if not resultado.confirmada or resultado.reconectada_mientras_tanto:
                        # Un fallo conserva estado y credenciales para reintentar.
                        transaction.set_rollback(True)

    def validar_limpieza(self, organizacion_id):
        if self._tenant_inconsistente(organizacion_id):
            return Response({"code": "datos_tenant_inconsistentes"}, status=409)
        # El bloqueo de organización ya está tomado por la limpieza final.
        # Una reconexión o cuenta nueva exige preparar de nuevo, incluso Outlook.
        versiones_actuales = dict(CuentaConectada.objects.filter(
            organizacion_id=organizacion_id,
        ).values_list("pk", "credenciales_version"))
        if versiones_actuales != self._versiones_preparadas:
            return Response({"code": "credenciales_cambiadas"}, status=409)
        pendientes = list(
            CuentaConectada.objects.filter(
                organizacion_id=organizacion_id, revocado_en__isnull=True,
            ).exclude(proveedor=CuentaConectada.Proveedor.CSV)
        )
        # Solo bloquean las cuentas de proveedores que sí ofrecen revocación.
        # Para Outlook la ausencia de `revocado_en` es la limitación conocida,
        # no una revocación pendiente. Un proveedor desconocido se trata como
        # soportado por seguridad.
        if any(
            proveedores.soporta_revocacion(cuenta.proveedor)
            for cuenta in pendientes
        ):
            return Response({"code": "revocacion_proveedor_pendiente"}, status=409)
        self._cuentas_sin_revocacion = len(pendientes)
        self._proveedores_sin_revocacion = sorted(
            {cuenta.proveedor for cuenta in pendientes}
        )

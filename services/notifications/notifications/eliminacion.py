from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.borrado.bloqueo import bloquear_organizacion
from shared.eliminacion import LimpiezaOrganizacionView, validar_solicitud_eliminacion
from .models import (
    Alerta,
    PreferenciaNotificacion,
    SuscripcionVigilada,
    UsuarioEliminado,
)


class LimpiezaNotificationsView(LimpiezaOrganizacionView):
    servicio = "notifications"
    # TODOS los modelos de tenant del servicio, incluida la proyección de
    # FE-17/18: `SuscripcionVigilada` guarda nombre del servicio, monto y
    # fecha de cobro, así que dejarla fuera era conservar datos personales
    # después de confirmar el borrado. Los cuatro son `ModeloTenant` con UUID
    # suelto y sin FK entre ellos, así que el orden hijo/padre no aplica acá;
    # `test_eliminacion_proyeccion` exige que la lista cubra los cuatro para
    # que el próximo modelo no se olvide igual.
    modelos = (Alerta, PreferenciaNotificacion, SuscripcionVigilada, UsuarioEliminado)


class LimpiezaUsuarioNotificationsView(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(exclude=True)
    def delete(self, request, organizacion_id, usuario_id):
        validar_solicitud_eliminacion(request, f"notifications:usuario:{usuario_id}", organizacion_id)
        with transaction.atomic():
            estado = bloquear_organizacion(organizacion_id)
            if estado.eliminada:
                # La limpieza de la organización ya borró todo, también lo de
                # esta persona. Recrear la marca dejaría una fila que nadie
                # vuelve a borrar en un tenant eliminado.
                return Response(status=204)
            UsuarioEliminado.objects.get_or_create(
                organizacion_id=organizacion_id, usuario_id=str(usuario_id),
            )
            PreferenciaNotificacion.objects.filter(
                organizacion_id=organizacion_id, usuario_id=str(usuario_id),
            ).delete()
        return Response(status=204)

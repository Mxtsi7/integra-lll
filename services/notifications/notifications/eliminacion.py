from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.borrado.bloqueo import bloquear_organizacion
from shared.eliminacion import LimpiezaOrganizacionView, validar_solicitud_eliminacion
from .models import Alerta, PreferenciaNotificacion, UsuarioEliminado


class LimpiezaNotificationsView(LimpiezaOrganizacionView):
    servicio = "notifications"
    modelos = (Alerta, PreferenciaNotificacion, UsuarioEliminado)


class LimpiezaUsuarioNotificationsView(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(exclude=True)
    def delete(self, request, organizacion_id, usuario_id):
        validar_solicitud_eliminacion(request, f"notifications:usuario:{usuario_id}", organizacion_id)
        with transaction.atomic():
            bloquear_organizacion(organizacion_id)
            UsuarioEliminado.objects.get_or_create(
                organizacion_id=organizacion_id, usuario_id=str(usuario_id),
            )
            PreferenciaNotificacion.objects.filter(
                organizacion_id=organizacion_id, usuario_id=str(usuario_id),
            ).delete()
        return Response(status=204)

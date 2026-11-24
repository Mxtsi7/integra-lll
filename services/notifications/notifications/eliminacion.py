from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.borrado.bloqueo import bloquear_organizacion
from shared.eliminacion import LimpiezaOrganizacionView, validar_solicitud_eliminacion
from .models import (
    Alerta,
    DireccionCorreo,
    EntregaAlerta,
    EventoRecibido,
    PreferenciaNotificacion,
    SuscripcionVigilada,
    UsuarioEliminado,
)


class LimpiezaNotificationsView(LimpiezaOrganizacionView):
    servicio = "notifications"
    # TODOS los modelos de tenant del servicio, incluida la proyección de
    # FE-17/18: `SuscripcionVigilada` guarda nombre del servicio, monto y
    # fecha de cobro, así que dejarla fuera era conservar datos personales
    # después de confirmar el borrado. `test_eliminacion_proyeccion` exige
    # que la lista cubra todos para que el próximo modelo no se olvide igual.
    #
    # El orden importa desde S3-FE-21:
    # · `EntregaAlerta` antes que `Alerta`, su padre por FK;
    # · `PreferenciaNotificacion` antes que `EntregaAlerta`, porque el
    #   despachador bloquea en ese orden (preferencia, después entrega). Con
    #   el orden contrario, una limpieza y un reclamo de la misma persona
    #   podían esperarse el uno al otro.
    modelos = (
        PreferenciaNotificacion, EntregaAlerta, DireccionCorreo, Alerta,
        SuscripcionVigilada, UsuarioEliminado, EventoRecibido,
    )


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
            # Mismo orden que el despachador: preferencias y después entregas.
            # Las entregas guardan la dirección usada (`destino`), y
            # `DireccionCorreo` es el correo mismo: datos de la persona.
            de_la_persona = dict(organizacion_id=organizacion_id, usuario_id=str(usuario_id))
            PreferenciaNotificacion.objects.filter(**de_la_persona).delete()
            EntregaAlerta.objects.filter(**de_la_persona).delete()
            DireccionCorreo.objects.filter(**de_la_persona).delete()
        return Response(status=204)

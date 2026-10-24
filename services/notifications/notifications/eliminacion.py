from shared.eliminacion import LimpiezaOrganizacionView
from .models import Alerta


class LimpiezaNotificationsView(LimpiezaOrganizacionView):
    servicio = "notifications"
    modelos = (Alerta,)

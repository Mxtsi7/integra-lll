from shared.eliminacion import LimpiezaOrganizacionView
from .models import Alerta, PreferenciaNotificacion


class LimpiezaNotificationsView(LimpiezaOrganizacionView):
    servicio = "notifications"
    modelos = (Alerta, PreferenciaNotificacion)

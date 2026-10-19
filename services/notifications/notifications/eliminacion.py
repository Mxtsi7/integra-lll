from shared.eliminacion import LimpiezaOrganizacionView


class LimpiezaNotificationsView(LimpiezaOrganizacionView):
    # Este servicio todavía no contiene modelos de dominio (notifications/models.py).
    servicio = "notifications"

from shared.eliminacion import LimpiezaOrganizacionView


class LimpiezaAnalyticsView(LimpiezaOrganizacionView):
    # Este servicio todavía no contiene modelos de dominio (analytics/models.py).
    servicio = "analytics"

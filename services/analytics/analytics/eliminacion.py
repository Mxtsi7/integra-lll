from shared.eliminacion import LimpiezaOrganizacionView
from .models import CupoIngesta


class LimpiezaAnalyticsView(LimpiezaOrganizacionView):
    servicio = "analytics"
    # Las FK locales eliminan documentos, intentos y consumos del mismo cupo.
    modelos = (CupoIngesta,)


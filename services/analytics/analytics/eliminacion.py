from rest_framework.response import Response

from shared.eliminacion import LimpiezaOrganizacionView
from .models import (
    CoberturaUso, CupoIngesta, RecomendacionConsolidacion,
    RecomendacionDescartada, SuscripcionObservada, UsoMensual, UsoProyectado,
)


class LimpiezaAnalyticsView(LimpiezaOrganizacionView):
    servicio = "analytics"
    # Las FK locales eliminan documentos, intentos y consumos del mismo cupo.
    modelos = (
        RecomendacionDescartada, RecomendacionConsolidacion,
        CoberturaUso, UsoMensual, UsoProyectado, SuscripcionObservada, CupoIngesta,
    )

    def validar_limpieza(self, organizacion_id):
        if RecomendacionDescartada.objects.filter(
            recomendacion__organizacion_id=organizacion_id,
        ).exclude(organizacion_id=organizacion_id).exists():
            return Response({"code": "datos_tenant_inconsistentes"}, status=409)

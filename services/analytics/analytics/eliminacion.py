from django.db import connection
from rest_framework.response import Response

from shared.eliminacion import LimpiezaOrganizacionView
from .models import (
    CoberturaUso, CupoIngesta, RecomendacionConsolidacion,
    RecomendacionDescartada, SuscripcionObservada, UsoMensual, UsoProyectado,
)

# Tablas `uso_*` que escribe el consumidor TypeScript (S3-VI-07/09/11/12/14).
# No son modelos Django del servicio, así que la limpieza de modelos no las ve.
# `analytics.uso_mensual` NO está acá: es la tabla del modelo Django `UsoMensual`
# (FE-28), que se borra por su modelo. El agregado del pipeline tiene nombre
# propio (`uso_mensual_recolector`) para no colisionar con esa tabla.
# El orden respeta la FK de `uso_tramo` hacia `uso_evento`.
TABLAS_USO_RECOLECTORES = (
    "analytics.uso_tramo",
    "analytics.uso_evento",
    "analytics.uso_diario",
    "analytics.uso_mensual_recolector",
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

    def limpiar_datos_adicionales(self, organizacion_id):
        """Borra las tablas `uso_*` bajo el mismo bloqueo exclusivo del tenant.

        Si el despliegue todavía no aplicó el DDL de analytics-uso, la tabla no
        existe y no hay nada que borrar: se omite para no bloquear el borrado
        del resto del tenant. En PostgreSQL `to_regclass` resuelve el nombre
        calificado; en SQLite el pipeline no existe y el gancho es un no-op.
        """
        if connection.vendor != "postgresql":
            return

        with connection.cursor() as cursor:
            for tabla in TABLAS_USO_RECOLECTORES:
                cursor.execute("SELECT to_regclass(%s)", [tabla])
                if cursor.fetchone()[0] is None:
                    continue
                cursor.execute(
                    f"DELETE FROM {tabla} WHERE organizacion_id = %s",
                    [organizacion_id],
                )

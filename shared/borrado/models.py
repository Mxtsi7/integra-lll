from django.db import models


class EstadoOrganizacion(models.Model):
    """Marca local por esquema: serializa escrituras y evita recrear un tenant."""

    organizacion_id = models.UUIDField(primary_key=True)
    eliminada = models.BooleanField(default=False)
    operacion_id = models.UUIDField(null=True)

    class Meta:
        db_table = "estado_eliminacion_organizacion"

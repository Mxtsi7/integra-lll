from contextlib import contextmanager

from django.db import connection, transaction
from rest_framework.exceptions import PermissionDenied

from .models import EstadoOrganizacion


def bloquear_organizacion(organizacion_id, *, compartido=False):
    """Llamar dentro de atomic; la fila existe también antes del primer borrado."""
    EstadoOrganizacion.objects.get_or_create(organizacion_id=organizacion_id)
    if compartido and connection.vendor == "postgresql":
        tabla = connection.ops.quote_name(EstadoOrganizacion._meta.db_table)
        # FOR SHARE permite escrituras concurrentes; la limpieza usa FOR UPDATE.
        return list(EstadoOrganizacion.objects.raw(
            f"SELECT * FROM {tabla} WHERE organizacion_id = %s FOR SHARE",
            [organizacion_id],
        ))[0]
    return EstadoOrganizacion.objects.select_for_update().get(organizacion_id=organizacion_id)


@contextmanager
def escritura_organizacion(organizacion_id):
    """Contrato para trabajos internos que escriban datos fuera de HTTP."""
    with transaction.atomic():
        estado = bloquear_organizacion(organizacion_id, compartido=True)
        if estado.eliminada:
            raise PermissionDenied("La organización fue eliminada")
        yield

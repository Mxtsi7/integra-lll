from contextlib import contextmanager

from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from .models import EstadoOrganizacion


def bloquear_organizacion(organizacion_id):
    """Llamar dentro de atomic; la fila existe también antes del primer borrado."""
    EstadoOrganizacion.objects.get_or_create(organizacion_id=organizacion_id)
    return EstadoOrganizacion.objects.select_for_update().get(organizacion_id=organizacion_id)


@contextmanager
def escritura_organizacion(organizacion_id):
    """Contrato para trabajos internos que escriban datos fuera de HTTP."""
    with transaction.atomic():
        estado = bloquear_organizacion(organizacion_id)
        if estado.eliminada:
            raise PermissionDenied("La organización fue eliminada")
        yield

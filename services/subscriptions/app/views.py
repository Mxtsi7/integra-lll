"""Vistas del servicio de suscripciones."""

from app.models import Subscription
from app.serializers import SubscriptionSerializer
from shared.tenant.base import TenantViewSet


class SubscriptionViewSet(TenantViewSet):
    """
    CRUD completo de suscripciones con aislamiento multi-tenant estricto.

    - Filtra automáticamente por la organización del request (X-Organizacion-Id).
    - Asigna organizacion_id en la creación.
    - Soporta GET (list, retrieve), POST (create), PUT (update),
      PATCH (partial_update) y DELETE (destroy).
    - Devuelve 403 si falta la cabecera X-Organizacion-Id.
    - Devuelve 404 si el recurso solicitado no pertenece a la organización autenticada.
    """

    queryset = Subscription.objects.all()
    serializer_class = SubscriptionSerializer

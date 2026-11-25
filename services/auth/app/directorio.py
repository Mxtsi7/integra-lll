"""Quiénes son las personas de una organización y a qué correo escribirles (S3-FE-21).

    GET /internal/organizaciones/<organizacion_id>/destinatarios/

La consulta notifications para mandar alertas por correo. La firma, el
formato y por qué existe están en `shared/directorio.py`.

── Qué entrega y qué no ───────────────────────────────────────────────────
Solo `usuario_id` (el mismo valor que viaja en `X-Usuario-Id`) y `email` de
las cuentas ACTIVAS de ESA organización. Ni nombre, ni rol, ni estado de
verificación, ni nada de otra organización: lo mínimo para escribirle a
alguien.

── Por qué fuera de /api/ ─────────────────────────────────────────────────
El gateway solo enruta prefijos `/api/…`, así que esta ruta no se puede
pedir desde afuera. Igual exige firma: dentro del clúster cualquiera puede
llegar al puerto de auth si la NetworkPolicy no está aplicada.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.directorio import FirmaInvalida, verificar

from .models import User


class DestinatariosOrganizacionView(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(exclude=True)
    def get(self, request, organizacion_id):
        try:
            verificar(request.headers, organizacion_id)
        except FirmaInvalida:
            # Sin detalle: a quien no firma no se le explica por qué.
            return Response({"detail": "Solicitud interna inválida"}, status=403)
        destinatarios = (
            User.objects.filter(organizacion_id=organizacion_id, is_active=True)
            .order_by("pk")
            .values_list("pk", "email")
        )
        return Response({
            "destinatarios": [
                {"usuario_id": str(pk), "email": email} for pk, email in destinatarios
            ],
        })

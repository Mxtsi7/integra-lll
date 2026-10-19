"""Contrato interno de limpieza: firma por destino, tenant y operación (MX-07)."""

import hashlib
import hmac
import os
import time
import uuid

from django.db import transaction
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView


def cabeceras_eliminacion(servicio, organizacion_id, operacion_id):
    secreto = os.environ.get("ELIMINACION_INTERNA_SECRET", "")
    if not secreto:
        raise ValueError("ELIMINACION_INTERNA_SECRET no configurado")
    instante = str(int(time.time()))
    mensaje = f"{servicio}:{organizacion_id}:{operacion_id}:{instante}"
    firma = hmac.new(secreto.encode(), mensaje.encode(), hashlib.sha256).hexdigest()
    return {"X-Eliminacion-Instante": instante, "X-Eliminacion-Firma": firma}


class LimpiezaOrganizacionView(APIView):
    """Cada servicio declara únicamente sus propios modelos, en orden hijo/padre."""

    authentication_classes = []
    permission_classes = []
    servicio = None
    modelos = ()

    def delete(self, request, organizacion_id):
        try:
            operacion_id = str(uuid.UUID(str(request.data.get("operacion_id"))))
            instante = request.headers.get("X-Eliminacion-Instante", "")
            if abs(time.time() - int(instante)) > 60:
                raise ValueError
        except (ValueError, TypeError, OverflowError):
            raise PermissionDenied("Solicitud interna inválida")
        secreto = os.environ.get("ELIMINACION_INTERNA_SECRET", "")
        mensaje = f"{self.servicio}:{organizacion_id}:{operacion_id}:{instante}"
        esperada = hmac.new(secreto.encode(), mensaje.encode(), hashlib.sha256).hexdigest()
        firma = request.headers.get("X-Eliminacion-Firma", "")
        if not secreto or not firma.isascii() or not hmac.compare_digest(esperada, firma):
            raise PermissionDenied("Solicitud interna inválida")
        from shared.borrado.bloqueo import bloquear_organizacion

        with transaction.atomic():
            estado = bloquear_organizacion(organizacion_id)
            estado.eliminada = True
            estado.operacion_id = operacion_id
            estado.save(update_fields=["eliminada", "operacion_id"])
            bloqueo = self.validar_limpieza(organizacion_id)
            if bloqueo is not None:
                return bloqueo
            for modelo in self.modelos:
                modelo.objects.filter(organizacion_id=organizacion_id).delete()
        return Response(status=204)

    def validar_limpieza(self, organizacion_id):
        pass

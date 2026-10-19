"""RF-01.7: reautenticación, revocación y coordinación durable entre servicios."""

import os
import uuid

import requests
from django.core.cache import caches
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from redis.exceptions import RedisError
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from shared.eliminacion import cabeceras_eliminacion
from .models import EliminacionOrganizacion, Organizacion, User

SERVICIOS = {"subscriptions": 8002, "connectors": 8003, "analytics": 8004, "notifications": 8005}


class EliminarCuentaSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirmacion = serializers.ChoiceField(choices=["ELIMINAR"])
    confirmacion_organizacion = serializers.ChoiceField(choices=["ELIMINAR"], required=False)


class EliminarCuentaMixin:
    @extend_schema(
        tags=["Usuarios"], summary="Eliminar cuenta propia (RF-01.7)",
        request=EliminarCuentaSerializer,
        responses={204: OpenApiResponse(description="Cuenta eliminada; organización conservada o usuario sin organización."),
                   202: OpenApiResponse(description="Cuenta eliminada; limpieza de organización pendiente."),
                   400: OpenApiResponse(description="Confirmación o contraseña ausente."),
                   403: OpenApiResponse(description="Identidad o contraseña inválida."),
                   409: OpenApiResponse(description="Último titular: falta confirmacion_organizacion=ELIMINAR."),
                   503: OpenApiResponse(description="No se pudieron revocar las sesiones; sin eliminación.")},
    )
    def delete(self, request, *args, **kwargs):
        serializer = EliminarCuentaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            usuario_id = int(request.headers.get("X-Usuario-Id", ""))
            if not 0 < usuario_id <= 2**63 - 1:
                raise ValueError
            organizacion_cabecera = request.headers.get("X-Organizacion-Id")
            organizacion_id = uuid.UUID(organizacion_cabecera) if organizacion_cabecera else None
        except (ValueError, TypeError, AttributeError):
            raise PermissionDenied("Falta el contexto de usuario y organización")
        try:
            with transaction.atomic():
                usuarios = User.objects.select_for_update()
                if organizacion_id is not None:
                    # Mismo bloqueo que el registro: impide incorporaciones durante el borrado.
                    organizacion = get_object_or_404(Organizacion.objects.select_for_update(), pk=organizacion_id)
                    usuarios = usuarios.filter(organizacion=organizacion)
                usuario = get_object_or_404(usuarios, pk=usuario_id, is_active=True)
                if organizacion_id is None and usuario.organizacion_id is not None:
                    raise PermissionDenied("Falta el contexto de organización")
                if not usuario.check_password(serializer.validated_data["password"]):
                    raise PermissionDenied("Contraseña inválida")
                ultimo_titular = organizacion_id is not None and usuario.rol == User.Rol.TITULAR and not usuarios.filter(
                    rol=User.Rol.TITULAR, is_active=True,
                ).exclude(pk=usuario.pk).exists()
                if ultimo_titular and serializer.validated_data.get("confirmacion_organizacion") != "ELIMINAR":
                    return Response({"code": "confirmacion_organizacion_requerida"}, status=409)
                afectados = usuarios if ultimo_titular else usuarios.filter(pk=usuario.pk)
                for pk in afectados.values_list("pk", flat=True):
                    caches["sesiones"].delete(f"usuario:{pk}")
                if ultimo_titular:
                    operacion = EliminacionOrganizacion.objects.create(
                        organizacion_id=organizacion_id, pendientes=list(SERVICIOS),
                    )
                afectados.delete()
        except (RedisError, OSError):
            return Response({"detail": "No se pudieron revocar las sesiones."}, status=503)
        if ultimo_titular:
            return Response({"operacion_id": str(operacion.pk), "estado": "pendiente"}, status=202)
        return Response(status=204)


def procesar_eliminacion(operacion_id):
    """Al menos una entrega; ACK 204 solamente. Un fallo nunca descarta el trabajo."""
    with transaction.atomic():
        operacion = EliminacionOrganizacion.objects.select_for_update().get(pk=operacion_id)
        for servicio in list(operacion.pendientes):
            base = os.environ.get(f"URL_{servicio.upper()}", f"http://{servicio}:{SERVICIOS[servicio]}")
            try:
                respuesta = requests.delete(
                    f"{base.rstrip('/')}/internal/organizaciones/{operacion.organizacion_id}/",
                    json={"operacion_id": str(operacion.pk)},
                    headers={**cabeceras_eliminacion(servicio, operacion.organizacion_id, operacion.pk),
                             "X-Correlation-ID": str(operacion.pk)},
                    timeout=(2, 5), allow_redirects=False,
                )
            except (requests.RequestException, ValueError):
                continue
            if respuesta.status_code == 204:
                operacion.pendientes.remove(servicio)
        if not operacion.pendientes:
            # No hay FK entre servicios; cada ACK corresponde a su esquema.
            Organizacion.objects.filter(pk=operacion.organizacion_id).delete()
            operacion.completado_en = timezone.now()
        operacion.save(update_fields=["pendientes", "completado_en"])
    return not operacion.pendientes

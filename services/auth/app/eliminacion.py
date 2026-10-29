"""RF-01.7: reautenticación, revocación y coordinación durable entre servicios."""

import os
import uuid

import requests
from django.core.cache import caches
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from redis.exceptions import RedisError
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from shared.eliminacion import cabeceras_eliminacion
from .models import ConsentimientoDisociado, EliminacionOrganizacion, EliminacionUsuario, Organizacion, User
from .openapi import EsquemaEliminarCuenta

SERVICIOS = {"subscriptions": 8002, "connectors": 8003, "analytics": 8004, "notifications": 8005}


def destinos_eliminacion():
    valor = os.environ.get("ELIMINACION_DESTINOS", ",".join(SERVICIOS))
    destinos = [nombre.strip() for nombre in valor.split(",") if nombre.strip()]
    if not destinos or len(set(destinos)) != len(destinos) or set(destinos) - SERVICIOS.keys():
        raise ImproperlyConfigured("ELIMINACION_DESTINOS debe listar destinos conocidos, sin duplicados")
    return destinos


def conservar_consentimientos(usuarios):
    eliminado_en = timezone.now()
    try:
        retener_hasta = eliminado_en.replace(year=eliminado_en.year + 6)
    except ValueError:  # 29 de febrero: el sexto año puede no ser bisiesto.
        retener_hasta = eliminado_en.replace(year=eliminado_en.year + 6, day=28)
    ConsentimientoDisociado.objects.bulk_create([
        ConsentimientoDisociado(
            consentimiento_en=fecha, eliminado_en=eliminado_en, retener_hasta=retener_hasta,
        ) for fecha in usuarios.exclude(consentimiento_en__isnull=True).values_list("consentimiento_en", flat=True)
    ])


class EliminarCuentaSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirmacion = serializers.ChoiceField(choices=["ELIMINAR"])
    confirmacion_organizacion = serializers.ChoiceField(
        choices=["ELIMINAR"], required=False,
        help_text="Obligatoria si el usuario es el último titular de la organización: enviar ELIMINAR; de lo contrario responde 409.",
    )


from .contratos_auth import EliminacionAceptadaSerializer


class EliminarCuentaMixin:
    schema = EsquemaEliminarCuenta()

    @extend_schema(
        tags=["Usuarios"], summary="Eliminar cuenta propia (RF-01.7)",
        request=EliminarCuentaSerializer,
        responses={204: OpenApiResponse(description="Cuenta eliminada; organización conservada o usuario sin organización."),
                   202: OpenApiResponse(response=EliminacionAceptadaSerializer, description="Cuenta eliminada; limpieza de organización pendiente."),
                   400: OpenApiResponse(description="Confirmación o contraseña ausente."),
                   403: OpenApiResponse(description="Identidad o contraseña inválida."),
                   409: OpenApiResponse(description="Último titular: falta confirmacion_organizacion=ELIMINAR."),
                   503: OpenApiResponse(description="No se pudieron revocar las sesiones; sin eliminación.")},
    )
    def delete(self, request, *args, **kwargs):
        serializer = EliminarCuentaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        destinos = destinos_eliminacion()
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
                        organizacion_id=organizacion_id, pendientes=destinos,
                    )
                elif organizacion_id is not None and "notifications" in destinos:
                    EliminacionUsuario.objects.create(
                        organizacion_id=organizacion_id, usuario_id=usuario.pk,
                        pendientes=["notifications"],
                    )
                conservar_consentimientos(afectados)
                afectados.delete()
        except (RedisError, OSError):
            return Response({"detail": "No se pudieron revocar las sesiones."}, status=503)
        if ultimo_titular:
            return Response({"operacion_id": str(operacion.pk), "estado": "pendiente"}, status=202)
        return Response(status=204)


def procesar_eliminacion(operacion_id, *, por_usuario=False):
    """Al menos una entrega; ACK 204 solamente. Un fallo nunca descarta el trabajo."""
    with transaction.atomic():
        modelo = EliminacionUsuario if por_usuario else EliminacionOrganizacion
        operacion = modelo.objects.select_for_update().get(pk=operacion_id)
        for servicio in list(operacion.pendientes):
            base = os.environ.get(f"URL_{servicio.upper()}", f"http://{servicio}:{SERVICIOS[servicio]}")
            recurso = f"/internal/organizaciones/{operacion.organizacion_id}/"
            destino_firma = servicio
            if por_usuario:
                recurso += f"usuarios/{operacion.usuario_id}/"
                destino_firma += f":usuario:{operacion.usuario_id}"
            try:
                respuesta = requests.delete(
                    f"{base.rstrip('/')}{recurso}",
                    json={"operacion_id": str(operacion.pk)},
                    headers={**cabeceras_eliminacion(destino_firma, operacion.organizacion_id, operacion.pk),
                             "X-Correlation-ID": str(operacion.pk)},
                    timeout=(2, 5), allow_redirects=False,
                )
            except (requests.RequestException, ValueError):
                continue
            if respuesta.status_code == 204:
                operacion.pendientes.remove(servicio)
        if not operacion.pendientes:
            # No hay FK entre servicios; cada ACK corresponde a su esquema.
            if not por_usuario:
                Organizacion.objects.filter(pk=operacion.organizacion_id).delete()
            operacion.completado_en = timezone.now()
        operacion.save(update_fields=["pendientes", "completado_en"])
    return not operacion.pendientes

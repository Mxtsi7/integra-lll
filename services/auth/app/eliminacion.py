"""RF-01.7: reautenticación, revocación y coordinación durable entre servicios."""

import logging
import os
import uuid
from datetime import timedelta

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

logger = logging.getLogger(__name__)

SERVICIOS = {"subscriptions": 8002, "connectors": 8003, "analytics": 8004, "notifications": 8005}


def destinos_eliminacion():
    valor = os.environ.get("ELIMINACION_DESTINOS", ",".join(SERVICIOS))
    destinos = [nombre.strip() for nombre in valor.split(",") if nombre.strip()]
    if not destinos or len(set(destinos)) != len(destinos) or set(destinos) - SERVICIOS.keys():
        raise ImproperlyConfigured("ELIMINACION_DESTINOS debe listar destinos conocidos, sin duplicados")
    return destinos


def configuracion_eliminacion():
    """Destinos y secreto, comprobados antes de borrar a nadie.

    Sin secreto el worker no puede firmar ninguna limpieza: los usuarios se
    borrarían sin vuelta atrás y la operación quedaría pendiente para siempre.
    """
    destinos = destinos_eliminacion()
    if not os.environ.get("ELIMINACION_INTERNA_SECRET", ""):
        raise ImproperlyConfigured("ELIMINACION_INTERNA_SECRET no configurado")
    return destinos


def conservar_consentimientos(usuarios):
    # Solo el día: el instante exacto se cruzaba con `creado_en` de la operación
    # de borrado, que conserva la persona y la organización.
    eliminado_en = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        aniversario = eliminado_en.replace(year=eliminado_en.year + 6)
    except ValueError:  # 29 de febrero: el sexto año puede no ser bisiesto.
        aniversario = eliminado_en.replace(year=eliminado_en.year + 6, day=28)
    # Hasta el fin del día del aniversario: truncar no acorta los seis años.
    retener_hasta = aniversario + timedelta(days=1)
    ConsentimientoDisociado.objects.bulk_create([
        ConsentimientoDisociado(
            consentimiento_en=fecha, eliminado_en=eliminado_en, retener_hasta=retener_hasta,
        ) for fecha in usuarios.exclude(consentimiento_en__isnull=True).values_list("consentimiento_en", flat=True)
    ])


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
                   503: OpenApiResponse(description="No se pudieron revocar las sesiones o la limpieza entre servicios no está configurada; sin eliminación.")},
    )
    def delete(self, request, *args, **kwargs):
        serializer = EliminarCuentaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            destinos = configuracion_eliminacion()
        except ImproperlyConfigured as exc:
            # Mejor no borrar que dejar una limpieza que nunca podrá terminar.
            logger.error("Eliminación de cuentas no disponible: %s", exc)
            return Response({"code": "eliminacion_no_configurada"}, status=503)
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
        if operacion.completado_en is not None:
            # Reprocesarla no reescribe la fecha que se mide contra las 72 h.
            return True
        for servicio in list(operacion.pendientes):
            base = os.environ.get(f"URL_{servicio.upper()}", f"http://{servicio}:{SERVICIOS[servicio]}")
            recurso = f"/internal/organizaciones/{operacion.organizacion_id}/"
            destino_firma = servicio
            if por_usuario:
                recurso += f"usuarios/{operacion.usuario_id}/"
                destino_firma += f":usuario:{operacion.usuario_id}"
            try:
                firma = cabeceras_eliminacion(destino_firma, operacion.organizacion_id, operacion.pk)
            except ValueError as exc:
                # Sin secreto no se puede firmar para ningún destino: queda
                # pendiente, pero diciendo por qué.
                logger.error("Limpieza %s pendiente: no se pudo firmar (%s)", operacion.pk, exc)
                break
            try:
                respuesta = requests.delete(
                    f"{base.rstrip('/')}{recurso}",
                    json={"operacion_id": str(operacion.pk)},
                    headers={**firma, "X-Correlation-ID": str(operacion.pk)},
                    timeout=(2, 5), allow_redirects=False,
                )
            except (requests.RequestException, ValueError) as exc:
                logger.warning(
                    "Limpieza %s pendiente en %s: sin respuesta (%s)", operacion.pk, servicio, type(exc).__name__,
                )
                continue
            if respuesta.status_code == 204:
                operacion.pendientes.remove(servicio)
            else:
                logger.warning(
                    "Limpieza %s pendiente en %s: respondió %s", operacion.pk, servicio, respuesta.status_code,
                )
        if not operacion.pendientes:
            # No hay FK entre servicios; cada ACK corresponde a su esquema.
            if not por_usuario:
                Organizacion.objects.filter(pk=operacion.organizacion_id).delete()
            operacion.completado_en = timezone.now()
        operacion.save(update_fields=["pendientes", "completado_en"])
    return not operacion.pendientes

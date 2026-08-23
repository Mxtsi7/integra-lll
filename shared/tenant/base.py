"""
BASE MULTI-TENANT COMPARTIDA POR TODOS LOS SERVICIOS

Se monta en cada contenedor como /app/shared (solo lectura). Es el único
código duplicado entre servicios, y está acá a propósito: el aislamiento
entre organizaciones tiene que comportarse EXACTAMENTE igual en los cinco.

⚠️ Un cambio en este archivo afecta a los seis integrantes. Se avisa antes.
"""

import uuid

from django.db import models
from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied


# ═══════════════════════════════════════════════════════════════════
# MODELOS
# ═══════════════════════════════════════════════════════════════════

class ModeloBase(models.Model):
    """
    Base de cualquier tabla del sistema.

    UUID en vez de entero autoincremental: los identificadores cruzan
    fronteras de servicio y aparecen en URLs y eventos. Con id=1, 2, 3
    cualquiera prueba id=2 a ver si le muestra datos ajenos.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["-creado_en"]


class ModeloTenant(ModeloBase):
    """
    Base de las tablas que pertenecen a una organización.

    Ojo con una diferencia respecto de un monolito: acá `organizacion_id`
    NO es una clave foránea. La tabla de organizaciones vive en el esquema
    de `auth`, y ningún servicio consulta el esquema de otro (ADR-002).
    Es un UUID suelto, y la integridad referencial se sostiene con el
    evento `usuario.eliminado`.
    """

    organizacion_id = models.UUIDField(db_index=True)

    class Meta:
        abstract = True
        ordering = ["-creado_en"]
        indexes = [models.Index(fields=["organizacion_id", "-creado_en"])]


# ═══════════════════════════════════════════════════════════════════
# CONTEXTO DE LA PETICIÓN
# ═══════════════════════════════════════════════════════════════════

class ContextoTenantMiddleware:
    """
    Lee las cabeceras que inyecta el gateway y las deja en request.

    El gateway ya validó el JWT (ADR-004). Los servicios internos confían
    en estas cabeceras porque no están expuestos fuera de la red interna.
    """

    RUTAS_LIBRES = ("/health/", "/api/schema/", "/api/docs/")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.organizacion_id = request.headers.get("X-Organizacion-Id")
        request.usuario_id = request.headers.get("X-Usuario-Id")
        request.rol = request.headers.get("X-Rol")
        request.correlation_id = request.headers.get("X-Correlation-ID")
        return self.get_response(request)


# ═══════════════════════════════════════════════════════════════════
# VIEWSETS
# ═══════════════════════════════════════════════════════════════════

class TenantViewSet(viewsets.ModelViewSet):
    """
    ViewSet con aislamiento por organización.

        class SuscripcionViewSet(TenantViewSet):
            serializer_class = SuscripcionSerializer
            queryset = Suscripcion.objects.all()

    · get_queryset()   filtra por la organización de la petición. Cubre las
                       cinco operaciones REST de una vez, porque todas pasan
                       por acá.
    · perform_create() asigna la organización desde la cabecera, para que
                       nadie pueda mandar un organizacion_id ajeno en el
                       cuerpo de la petición.

    Si no viene la cabecera, responde 403 en vez de devolver todo. El caso
    normal es que el gateway siempre la manda; que falte significa que algo
    está mal configurado, y ante la duda no se entregan datos.
    """

    def get_queryset(self):
        org = getattr(self.request, "organizacion_id", None)
        if not org:
            raise PermissionDenied("Falta el contexto de organización")
        return super().get_queryset().filter(organizacion_id=org)

    def perform_create(self, serializer):
        org = getattr(self.request, "organizacion_id", None)
        if not org:
            raise PermissionDenied("Falta el contexto de organización")
        serializer.save(organizacion_id=org)


class SoloLecturaTenantViewSet(TenantViewSet, viewsets.ReadOnlyModelViewSet):
    """Igual que TenantViewSet pero sin escritura. Para reportes y consultas."""

    pass

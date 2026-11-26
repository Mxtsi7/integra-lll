"""Consentimiento auditable y ventanas autorizadas para la recepción v1."""
from datetime import datetime
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from app.models import ConsentimientoRecolector, Subscription
from shared.borrado.bloqueo import bloquear_organizacion
from .validacion import ErrorEventoUso, texto_utc


def bloquear_destino(suscripcion):
    # Mismo orden que persistencia: organización -> suscripción -> consentimiento.
    if bloquear_organizacion(suscripcion.organizacion_id, compartido=True).eliminada:
        raise PermissionDenied('La organización fue eliminada.')
    return Subscription.objects.select_for_update().get(
        pk=suscripcion.pk, organizacion_id=suscripcion.organizacion_id)


def clave(suscripcion, usuario_id, recolector_id):
    return dict(organizacion_id=suscripcion.organizacion_id, suscripcion=suscripcion,
                usuario_id=usuario_id, recolector_id=recolector_id)


def serializar(consentimiento):
    return dict(recolector_id=str(consentimiento.recolector_id), origen=consentimiento.origen,
        estado=consentimiento.estado, version_texto=consentimiento.version_texto,
        desde=consentimiento.ventanas[-1]['desde'] if consentimiento.ventanas else None,
        actualizado_en=texto_utc(consentimiento.actualizado_en),
        servidor_ahora=texto_utc(timezone.now()),
        zona_horaria=getattr(settings, 'USO_ZONA_HORARIA', settings.TIME_ZONE))


@transaction.atomic
def gestionar(request, suscripcion, usuario_id):
    datos = request.query_params if request.method == 'GET' else request.data
    try:
        recolector_id = UUID(str(datos.get('recolector_id', '')))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValidationError({'recolector_id': 'Se requiere un UUID válido.'}) from error
    if request.method == 'POST':
        if datos.get('origen') not in ('android', 'navegador'):
            raise ValidationError({'origen': 'Origen no soportado.'})
        if datos.get('accion') not in ('aceptar', 'pausar', 'reanudar', 'revocar'):
            raise ValidationError({'accion': 'Acción no soportada.'})
        if datos.get('version_texto') != 'uso-v1':
            raise ValidationError({'version_texto': 'Versión de consentimiento no soportada.'})
        bloquear_destino(suscripcion)
    registro = ConsentimientoRecolector.objects.filter(**clave(suscripcion, usuario_id, recolector_id)).first()
    if request.method == 'GET':
        if registro is None:
            raise NotFound('No existe consentimiento propio para este recolector.')
        return Response(serializar(registro))
    accion = datos['accion']
    ahora = texto_utc(timezone.now())
    if registro is None:
        if accion not in ('aceptar', 'revocar'):
            raise NotFound('No existe consentimiento para modificar.')
        # Revocar un UUID todavía desconocido deja una lápida: una aceptación
        # retrasada por la red no podrá habilitarlo después del retiro.
        registro = ConsentimientoRecolector.objects.create(
            **clave(suscripcion, usuario_id, recolector_id), origen=datos['origen'],
            version_texto=datos['version_texto'], estado='revocado' if accion == 'revocar' else 'activo',
            ventanas=[] if accion == 'revocar' else [{'desde': ahora, 'hasta': None}])
    else:
        if registro.origen != datos['origen']:
            raise ValidationError({'origen': 'El recolector ya tiene otro origen.'})
        if registro.estado == 'revocado' and accion != 'revocar':
            raise ErrorEventoUso('Autoriza un nuevo recolector para volver a capturar.', 'recolector_revocado', 409)
        if accion == 'aceptar' and registro.estado != 'activo':
            raise ErrorEventoUso('El recolector está pausado; debes reanudarlo.', 'recolector_pausado', 409)
        nuevo = {'pausar': 'pausado', 'reanudar': 'activo', 'revocar': 'revocado'}.get(accion, registro.estado)
        if nuevo != registro.estado:
            if registro.estado == 'activo':
                registro.ventanas[-1]['hasta'] = ahora
            if nuevo == 'activo':
                registro.ventanas.append({'desde': ahora, 'hasta': None})
            registro.estado = nuevo
            registro.save(update_fields=['estado', 'ventanas', 'actualizado_en'])
    return Response(serializar(registro))


def verificar(*, suscripcion, usuario_id, evento):
    """El llamador mantiene bloqueada la suscripción hasta terminar el INSERT."""
    registro = ConsentimientoRecolector.objects.filter(
        **clave(suscripcion, usuario_id, evento.cuerpo['recolector_id']),
        origen=evento.cuerpo['origen'],
    ).first()
    if registro is None or registro.estado == 'revocado' or evento.fin > timezone.now():
        return False
    def instante(texto):
        return datetime.fromisoformat(texto.replace('Z', '+00:00'))
    return any(evento.inicio >= instante(ventana['desde']) and
        (ventana['hasta'] is None or evento.fin <= instante(ventana['hasta']))
        for ventana in registro.ventanas)

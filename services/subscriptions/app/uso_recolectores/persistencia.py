"""Inserta hechos durables y resuelve reintentos según la clave v1."""
from datetime import timezone

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.response import Response

from app.models import EventoUsoRecibido, Subscription
from .validacion import ErrorEventoUso
from .proyeccion import proyectar

NOMBRE_RESTRICCION_CLAVE = 'uso_rx_evento_clave_unica'


def _acuse(evento, estado, codigo_http):
    return Response({
        'event_id': str(evento.event_id),
        'suscripcion_id': str(evento.suscripcion_id),
        'recibido_en': evento.recibido_en.astimezone(timezone.utc).isoformat(
            timespec='milliseconds',
        ).replace('+00:00', 'Z'),
        'estado': estado,
    }, status=codigo_http)


def _conflicto(mensaje):
    raise ErrorEventoUso(mensaje, 'event_id_conflictivo', status.HTTP_409_CONFLICT)


@transaction.atomic
def persistir(*, suscripcion, usuario_id, evento, correlacion):
    """Guarda el hecho y su trabajo pendiente antes de emitir el acuse."""
    destino = Subscription.objects.select_for_update().filter(
        pk=suscripcion.pk, organizacion_id=suscripcion.organizacion_id,
    ).first()
    if destino is None:
        raise ErrorEventoUso('La suscripción dejó de estar disponible.', 'suscripcion_no_encontrada', 404)

    valores_clave = {
        'organizacion_id': destino.organizacion_id,
        'usuario_id': usuario_id,
        'recolector_id': evento.cuerpo['recolector_id'],
        'event_id': evento.cuerpo['event_id'],
    }
    existente = EventoUsoRecibido.objects.filter(**valores_clave).first()
    if existente is not None:
        return _responder_existente(existente, destino, evento)

    try:
        # El savepoint permite clasificar solo la restricción idempotente sin
        # dejar inutilizable la transacción ante otros fallos de integridad.
        with transaction.atomic():
            recibido = EventoUsoRecibido.objects.create(
                **valores_clave,
                suscripcion=destino,
                cuerpo=evento.cuerpo,
                fecha_local=evento.fecha,
                correlation_id=correlacion,
                proyeccion_pendiente=True,
            )
            proyectar(destino, usuario_id, evento.fecha, correlacion)
            recibido.proyeccion_pendiente = False
            recibido.save(update_fields=('proyeccion_pendiente', 'actualizado_en'))
    except IntegrityError as error:
        diagnostico = getattr(getattr(error.__cause__, 'diag', None), 'constraint_name', None)
        if diagnostico != NOMBRE_RESTRICCION_CLAVE:
            raise
        existente = EventoUsoRecibido.objects.filter(**valores_clave).first()
        if existente is None:
            raise
        return _responder_existente(existente, destino, evento)

    return _acuse(recibido, 'aceptado', status.HTTP_201_CREATED)


def _responder_existente(existente, destino, evento):
    if existente.suscripcion_id != destino.pk or existente.cuerpo != evento.cuerpo:
        _conflicto('El identificador ya fue aceptado con otro contenido o destino.')
    return _acuse(existente, 'duplicado', status.HTTP_200_OK)

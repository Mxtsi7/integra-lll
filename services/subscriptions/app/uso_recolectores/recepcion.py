"""Frontera de integración: consentimiento servidor y almacenamiento durable."""
import logging

from django.conf import settings
from django.utils.module_loading import import_string

from .validacion import ErrorEventoUso, MAXIMO_CUERPO_BYTES, validar_evento

logger = logging.getLogger(__name__)


def proveedor(nombre):
    configurado = getattr(settings, nombre, None)
    return import_string(configurado) if isinstance(configurado, str) else configurado


def recibir(request, suscripcion, usuario_id, correlacion):
    # Medir antes de parsear JSON; la suscripción y la identidad ya están autorizadas.
    if len(request.body) > MAXIMO_CUERPO_BYTES:
        raise ErrorEventoUso('El cuerpo supera 4 KiB.')
    validado = validar_evento(request.data)
    comprobar = proveedor('USO_VERIFICAR_CONSENTIMIENTO')
    contexto = dict(suscripcion=suscripcion, usuario_id=usuario_id, evento=validado)
    if comprobar is None or not comprobar(**contexto):
        raise ErrorEventoUso('Falta consentimiento vigente de captura.', 'consentimiento_requerido', 403)
    zona_informe = getattr(settings, 'USO_ZONA_HORARIA', settings.TIME_ZONE)
    if validado.cuerpo['zona_horaria'] != zona_informe:
        raise ErrorEventoUso('La zona difiere de la configurada para el informe.')
    persistir = proveedor('USO_PERSISTIR_EVENTO')
    if persistir is None:
        logger.warning('Recepción sin almacenamiento durable: correlacion=%s', correlacion)
        raise ErrorEventoUso('Recepción durable todavía no disponible.', 'recepcion_no_disponible', 503)
    return persistir(**contexto, correlacion=correlacion)

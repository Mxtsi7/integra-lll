"""Proyecta la unión exacta diaria a RegistroUso sin editar filas manuales."""
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from app.models import EventoUsoRecibido, ProyeccionUsoRecolector, RegistroUso
from .validacion import instante, milisegundos


def _unir(intervalos):
    intervalos.sort(key=lambda intervalo: (intervalo[0], intervalo[1]))
    total_ms = 0
    fin_actual = None
    inicio_actual = None
    fin_actividad = None
    for inicio, fin in intervalos:
        fin_actividad = max(fin_actividad, fin) if fin_actividad else fin
        if fin_actual is None:
            inicio_actual, fin_actual = inicio, fin
        elif inicio <= fin_actual:
            fin_actual = max(fin_actual, fin)
        else:
            total_ms += milisegundos(inicio_actual, fin_actual)
            inicio_actual, fin_actual = inicio, fin
    if fin_actual is not None:
        total_ms += milisegundos(inicio_actual, fin_actual)
    return total_ms, fin_actividad


def proyectar(suscripcion, usuario_id, fecha_local, correlacion):
    """Recalcula desde hechos durables dentro de la transacción de recepción."""
    eventos = EventoUsoRecibido.objects.filter(
        organizacion_id=suscripcion.organizacion_id,
        usuario_id=usuario_id,
        suscripcion=suscripcion,
        fecha_local=fecha_local,
    ).order_by('recibido_en', 'id')
    intervalos = [
        (instante(tramo['inicio']), instante(tramo['fin']))
        for evento in eventos
        for tramo in evento.cuerpo['tramos_actividad']
    ]
    total_ms, ultima_actividad = _unir(intervalos)

    proyeccion, _ = ProyeccionUsoRecolector.objects.get_or_create(
        organizacion_id=suscripcion.organizacion_id,
        usuario_id=usuario_id,
        suscripcion=suscripcion,
        fecha_local=fecha_local,
        defaults={'zona_horaria': eventos.last().cuerpo['zona_horaria']},
    )
    proyeccion.duracion_union_ms = total_ms
    proyeccion.save(update_fields=('duracion_union_ms', 'actualizado_en'))

    if not total_ms:
        return

    registro = RegistroUso.objects.filter(
        organizacion_id=suscripcion.organizacion_id,
        usuario_id=usuario_id,
        suscripcion=suscripcion,
        fecha=fecha_local,
        origen=RegistroUso.Origen.RECOLECTOR,
    ).first()
    minutos_completos = total_ms // 60000
    if minutos_completos:
        if registro is None:
            registro = RegistroUso.objects.create(
                organizacion_id=suscripcion.organizacion_id,
                usuario_id=usuario_id,
                suscripcion=suscripcion,
                fecha=fecha_local,
                origen=RegistroUso.Origen.RECOLECTOR,
                minutos=minutos_completos,
                duracion_ms=total_ms,
            )
        else:
            registro.minutos = minutos_completos
            registro.duracion_ms = total_ms
            registro.save(update_fields=('minutos', 'duracion_ms', 'actualizado_en'))
        proyeccion.registro_uso = registro
        proyeccion.save(update_fields=('registro_uso', 'actualizado_en'))

    suscripcion.ultima_actividad = max(suscripcion.ultima_actividad, ultima_actividad) \
        if suscripcion.ultima_actividad else ultima_actividad
    campos_actualizados = ['ultima_actividad', 'actualizado_en']
    if suscripcion.estado == suscripcion.Estado.FANTASMA:
        suscripcion.transicionar(
            suscripcion.EventoEstado.USO_REGISTRADO,
            actor_id=usuario_id,
            actor_rol='usuario',
            correlation_id=correlacion,
        )

    hoy_local = timezone.localdate()
    if fecha_local.year == hoy_local.year and fecha_local.month == hoy_local.month:
        total_mes = RegistroUso.objects.filter(
            suscripcion=suscripcion,
            fecha__year=fecha_local.year,
            fecha__month=fecha_local.month,
        ).aggregate(total=Sum('minutos'))['total'] or 0
        suscripcion.horas_uso_mes = (Decimal(total_mes) / Decimal('60')).quantize(Decimal('0.01'))
        campos_actualizados.append('horas_uso_mes')
    suscripcion.save(update_fields=tuple(campos_actualizados))

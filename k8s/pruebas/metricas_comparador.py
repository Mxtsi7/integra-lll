"""Métricas del comparador calculadas desde timestamps persistidos por evento."""
from datetime import datetime
from uuid import UUID


def _fecha(fila, campo):
    valor = fila.get(campo)
    if not isinstance(valor, str) or not valor:
        raise ValueError(f'Falta un timestamp válido en {campo}.')
    try:
        # fromisoformat no acepta Z en Python 3.9, usado por el comparador.
        fecha = datetime.fromisoformat(valor.replace('Z', '+00:00'))
    except ValueError as error:
        raise ValueError(f'Timestamp inválido en {campo}.') from error
    if fecha.tzinfo is None or fecha.utcoffset() is None:
        raise ValueError(f'{campo} debe incluir zona horaria.')
    return fecha


def metricas_eventos(filas, modo):
    """Resume eventos acreditados sin incluir el retraso del sondeo de Kubernetes.

    ``lote_s`` abarca desde el primer ocurrido_en hasta el último hecho_en;
    ``evento_ms`` mide ese intervalo para cada evento, en el orden recibido.
    En modo 1, ``outbox_ms`` incluye la espera de despacho (también Beat y
    reintentos) hasta que se registra publicado_en.

    ``posterior_ms`` es el desfase publicación→evidencia, con signo, no una
    latencia pura de RabbitMQ. Despacho registra publicado_en después de la
    confirmación y cierre AMQP; el consumidor puede acreditar antes de ese
    registro. Se conservan esos valores negativos y se cuentan en solapados.
    En modo 0 no se calculan etapas de transporte ni se requiere publicado_en.
    Los timestamps acreditan registros de aplicación, no instantes de commit.
    """
    if modo not in (0, 1):
        raise ValueError('El modo debe ser 0 (síncrono) o 1 (asíncrono).')
    if not filas:
        raise ValueError('No se pueden calcular métricas de un lote vacío.')

    ids = set()
    ocurridos, hechos = [], []
    evento_ms, outbox_ms, posterior_ms = [], [], []
    for fila in filas:
        valor = fila.get('evento_id')
        if not isinstance(valor, str):
            raise ValueError('Falta un evento_id UUID válido.')
        try:
            evento_id = UUID(valor)
        except ValueError as error:
            raise ValueError('evento_id debe ser un UUID válido.') from error
        if evento_id in ids:
            raise ValueError(f'evento_id duplicado: {evento_id}.')
        ids.add(evento_id)

        ocurrido = _fecha(fila, 'ocurrido_en')
        hecho = _fecha(fila, 'hecho_en')
        duracion = (hecho - ocurrido).total_seconds()
        if duracion < 0:
            raise ValueError('hecho_en precede a ocurrido_en: revisar reloj y orden de timestamps.')
        ocurridos.append(ocurrido)
        hechos.append(hecho)
        evento_ms.append(duracion * 1000)

        if modo == 1:
            publicado = _fecha(fila, 'publicado_en')
            espera_outbox = (publicado - ocurrido).total_seconds()
            if espera_outbox < 0:
                raise ValueError('publicado_en precede a ocurrido_en: revisar reloj y orden de timestamps.')
            outbox_ms.append(espera_outbox * 1000)
            posterior_ms.append((hecho - publicado).total_seconds() * 1000)

    lote_s = (max(hechos) - min(ocurridos)).total_seconds()
    if lote_s < 0:
        raise ValueError('Duración del lote negativa: revisar reloj y orden de timestamps.')
    return dict(lote_s=lote_s, evento_ms=evento_ms, outbox_ms=outbox_ms,
                posterior_ms=posterior_ms, solapados=sum(t < 0 for t in posterior_ms))

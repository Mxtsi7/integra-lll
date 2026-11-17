import { describe, expect, it } from 'vitest';

import { ErrorValidacionUso } from '../src/dominio/errores';
import { crearEventoUsoRegistrado } from '../src/dominio/uso-registrado.event';
import { DATOS_BASE, IDS } from './fixtures';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function payloadCanonico() {
  const { suscripcion_id: _s, usuario_id: _u, ...payload } = DATOS_BASE;
  return payload;
}

describe('crearEventoUsoRegistrado (S3-VI-07)', () => {
  it('usa event_id como id del sobre y añade destino/tenant', () => {
    const evento = crearEventoUsoRegistrado(payloadCanonico(), {
      organizacionId: IDS.organizacion,
      suscripcionId: IDS.suscripcion,
      usuarioId: IDS.usuario,
      correlationId: IDS.correlacion,
      ocurridoEn: '2026-11-09T12:02:01Z',
    });

    expect(evento.evento).toBe('uso.registrado');
    expect(evento.version).toBe(1);
    expect(evento.id).toBe(evento.datos.event_id);
    expect(evento.organizacion_id).toBe(IDS.organizacion);
    expect(evento.datos.suscripcion_id).toBe(IDS.suscripcion);
    expect(evento.datos.usuario_id).toBe(IDS.usuario);
    expect(evento.correlation_id).toBe(IDS.correlacion);
    expect(evento.ocurrido_en).toBe('2026-11-09T12:02:01.000Z');
  });

  it('genera correlación UUID v4 y ocurrido_en UTC cuando no se pasan', () => {
    const evento = crearEventoUsoRegistrado(payloadCanonico(), {
      organizacionId: IDS.organizacion,
      suscripcionId: IDS.suscripcion,
    });
    expect(evento.correlation_id).toMatch(UUID_V4);
    expect(evento.ocurrido_en).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('rechaza el cuerpo canónico si trae identidad o destino', () => {
    expect(() =>
      crearEventoUsoRegistrado(
        { ...payloadCanonico(), usuario_id: IDS.usuario } as never,
        {
          organizacionId: IDS.organizacion,
          suscripcionId: IDS.suscripcion,
        },
      ),
    ).toThrow(ErrorValidacionUso);
  });

  it('rechaza un cuerpo semánticamente inválido antes de publicar', () => {
    expect(() =>
      crearEventoUsoRegistrado(
        { ...payloadCanonico(), duracion_ms: 60_000 },
        {
          organizacionId: IDS.organizacion,
          suscripcionId: IDS.suscripcion,
        },
      ),
    ).toThrow(ErrorValidacionUso);
  });
});

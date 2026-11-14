import { describe, expect, it } from 'vitest';

import { calcularHuella, serializarEstable } from '../src/dominio/huella';
import type { ContenidoHuella } from '../src/dominio/huella';

function contenido(cambios: Partial<ContenidoHuella> = {}): ContenidoHuella {
  return {
    organizacionId: '11111111-1111-4111-8111-111111111111',
    suscripcionId: '11111111-1111-4111-8111-111111111111',
    usuarioId: '5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d',
    eventId: '22222222-2222-4222-8222-222222222222',
    recolectorId: '33333333-3333-4333-8333-333333333333',
    origen: 'android',
    inicio: new Date('2026-11-09T12:00:00Z'),
    fin: new Date('2026-11-09T12:02:00Z'),
    duracionMs: 30_000,
    tramos: [
      {
        inicio: new Date('2026-11-09T12:00:00Z'),
        fin: new Date('2026-11-09T12:00:30Z'),
      },
    ],
    zonaHoraria: 'America/Santiago',
    cobertura: 'completa',
    estado: 'activo',
    ...cambios,
  };
}

describe('huella canónica', () => {
  it('serializa objetos con las claves en distinto orden igual', () => {
    const a = { b: 2, a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, b: 2 };
    expect(serializarEstable(a)).toBe(serializarEstable(b));
  });

  it('el mismo contenido normalizado produce la misma huella', () => {
    expect(calcularHuella(contenido())).toBe(calcularHuella(contenido()));
  });

  it('cambiar la duración cambia la huella', () => {
    expect(calcularHuella(contenido())).not.toBe(
      calcularHuella(contenido({ duracionMs: 30_001 })),
    );
  });

  it('cambiar el destino cambia la huella (conflicto de event_id)', () => {
    expect(calcularHuella(contenido())).not.toBe(
      calcularHuella(
        contenido({ suscripcionId: '99999999-9999-4999-8999-999999999999' }),
      ),
    );
  });

  it('el orden de inserción de las claves del contenido no importa', () => {
    const base = contenido();
    const reordenado: ContenidoHuella = {
      estado: base.estado,
      cobertura: base.cobertura,
      zonaHoraria: base.zonaHoraria,
      tramos: base.tramos,
      duracionMs: base.duracionMs,
      fin: base.fin,
      inicio: base.inicio,
      origen: base.origen,
      recolectorId: base.recolectorId,
      eventId: base.eventId,
      usuarioId: base.usuarioId,
      suscripcionId: base.suscripcionId,
      organizacionId: base.organizacionId,
    };
    expect(calcularHuella(reordenado)).toBe(calcularHuella(base));
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { formatearFechaHora, formatearFechaLarga, formatearMesAnio, nombresDiasSemana } from './formato';

// Zona de Chile (UTC-3/-4) aunque CI corra en UTC: así un new Date('YYYY-MM-DD')
// (medianoche UTC = el día anterior acá) hace fallar los tests de fechas.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Santiago');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('formatearMesAnio', () => {
  it('el mes va de 0 a 11, como en Date', () => {
    expect(formatearMesAnio(2026, 9)).toBe('octubre de 2026');
    expect(formatearMesAnio(2027, 0)).toBe('enero de 2027');
  });
});

describe('formatearFechaLarga', () => {
  it('nombra el día completo', () => {
    expect(formatearFechaLarga('2026-10-15')).toBe('jueves, 15 de octubre de 2026');
  });

  it('el primer día del mes no se corre al anterior por la zona horaria', () => {
    // new Date("2026-10-01") sería medianoche UTC: en Chile, el 30 de septiembre.
    expect(formatearFechaLarga('2026-10-01')).toBe('jueves, 1 de octubre de 2026');
  });
});

describe('formatearFechaHora', () => {
  it('muestra el día y la hora de un instante', () => {
    // Mediodía UTC: en cualquier zona entre UTC-11 y UTC+11 sigue siendo el 15.
    expect(formatearFechaHora('2026-10-15T12:00:00Z')).toMatch(/^15 oct 2026, \d{2}:\d{2}/);
  });
});

describe('nombresDiasSemana', () => {
  it('parte el lunes y termina el domingo', () => {
    expect(nombresDiasSemana('long')).toEqual([
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ]);
    expect(nombresDiasSemana('short')).toHaveLength(7);
  });
});

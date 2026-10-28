import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  diasDelMes,
  esDelMes,
  fechaDeIso,
  isoDeFecha,
  mesDeFecha,
  partesDeMes,
  primerDiaDelMes,
  semanasDelMes,
  sumarDias,
  sumarMeses,
  sumarMesesAFecha,
} from './calendario';

// Zona de Chile (UTC-3/-4) aunque CI corra en UTC: así un new Date('YYYY-MM-DD')
// (medianoche UTC = el día anterior acá) hace fallar los tests de fechas.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Santiago');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('diasDelMes: meses de distinto largo (CH-17)', () => {
  it.each([
    [2026, 0, 31, 'enero'],
    [2026, 1, 28, 'febrero de un año normal'],
    [2028, 1, 29, 'febrero bisiesto'],
    [2100, 1, 28, 'febrero de 2100: divisible por 100, no bisiesto'],
    [2000, 1, 29, 'febrero de 2000: divisible por 400, bisiesto'],
    [2026, 3, 30, 'abril'],
    [2026, 11, 31, 'diciembre'],
  ])('%i-%i tiene %i días (%s)', (anio, mes, dias) => {
    expect(diasDelMes(anio, mes)).toBe(dias);
  });
});

describe('semanasDelMes', () => {
  const dias = (semanas: (string | null)[][]) => semanas.flat().filter((d) => d !== null);

  it('octubre de 2026 parte un jueves: tres casillas vacías antes del 1', () => {
    const semanas = semanasDelMes(2026, 9);
    expect(semanas[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(dias(semanas)).toHaveLength(31);
    expect(semanas.at(-1)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
  });

  it('febrero de 2026 parte un domingo: el 1 va en la última columna', () => {
    const semanas = semanasDelMes(2026, 1);
    expect(semanas[0]).toEqual([null, null, null, null, null, null, '2026-02-01']);
    expect(dias(semanas)).toHaveLength(28);
  });

  it('febrero de 2027 cabe justo en 4 semanas; marzo de 2026 necesita 6', () => {
    expect(semanasDelMes(2027, 1)).toHaveLength(4); // 1 de febrero de 2027 es lunes
    expect(semanasDelMes(2026, 2)).toHaveLength(6); // 1 de marzo de 2026 es domingo, 31 días
  });

  it('todas las semanas tienen 7 casillas y los días van en orden', () => {
    for (let mes = 0; mes < 12; mes++) {
      const semanas = semanasDelMes(2026, mes);
      expect(semanas.every((s) => s.length === 7)).toBe(true);
      const delMes = dias(semanas);
      expect(delMes).toHaveLength(diasDelMes(2026, mes));
      expect(delMes[0]).toBe(isoDeFecha(new Date(2026, mes, 1)));
    }
  });
});

describe('fechas sin pasar por UTC', () => {
  it('el 1 del mes sigue siendo el 1 (new Date("2026-10-01") sería el 30 de septiembre en Chile)', () => {
    const fecha = fechaDeIso('2026-10-01');
    expect([fecha.getFullYear(), fecha.getMonth(), fecha.getDate()]).toEqual([2026, 9, 1]);
    expect(isoDeFecha(fecha)).toBe('2026-10-01');
  });

  it('esDelMes', () => {
    expect(esDelMes('2026-10-31', 2026, 9)).toBe(true);
    expect(esDelMes('2026-11-01', 2026, 9)).toBe(false);
    expect(esDelMes('2025-10-15', 2026, 9)).toBe(false);
  });

  it('sumarDias cruza meses y años', () => {
    expect(sumarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('meses "YYYY-MM" (CH-19)', () => {
  it('mesDeFecha, partesDeMes y primerDiaDelMes', () => {
    expect(mesDeFecha('2026-10-24')).toBe('2026-10');
    expect(partesDeMes('2026-10')).toEqual({ anio: 2026, mes: 9 });
    expect(primerDiaDelMes('2026-10')).toBe('2026-10-01');
  });

  it('sumarMeses cruza diciembre y enero', () => {
    expect(sumarMeses('2026-12', 1)).toBe('2027-01');
    expect(sumarMeses('2026-01', -1)).toBe('2025-12');
    expect(sumarMeses('2026-10', 14)).toBe('2027-12');
    expect(sumarMeses('2026-10', 0)).toBe('2026-10');
  });

  it('sumarMesesAFecha no se desborda en meses cortos', () => {
    expect(sumarMesesAFecha('2026-01-31', 1)).toBe('2026-02-28');
    expect(sumarMesesAFecha('2028-01-31', 1)).toBe('2028-02-29');
    expect(sumarMesesAFecha('2026-03-31', -1)).toBe('2026-02-28');
    expect(sumarMesesAFecha('2026-12-15', 1)).toBe('2027-01-15');
  });
});

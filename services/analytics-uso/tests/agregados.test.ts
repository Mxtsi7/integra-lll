import { describe, expect, it } from 'vitest';

import {
  proyectarMinutos,
  sumarMinutosDiarios,
} from '../src/dominio/agregados';

describe('proyección diaria de milisegundos a minutos', () => {
  it('conserva el residuo y no redondea hacia arriba', () => {
    expect(proyectarMinutos(0)).toEqual({
      msNetos: 0,
      minutosNetos: 0,
      msResiduo: 0,
    });
    expect(proyectarMinutos(30_000)).toEqual({
      msNetos: 30_000,
      minutosNetos: 0,
      msResiduo: 30_000,
    });
    expect(proyectarMinutos(60_000)).toEqual({
      msNetos: 60_000,
      minutosNetos: 1,
      msResiduo: 0,
    });
    expect(proyectarMinutos(90_000)).toEqual({
      msNetos: 90_000,
      minutosNetos: 1,
      msResiduo: 30_000,
    });
    expect(proyectarMinutos(119_999)).toEqual({
      msNetos: 119_999,
      minutosNetos: 1,
      msResiduo: 59_999,
    });
  });

  it('rechaza milisegundos negativos o no enteros', () => {
    expect(() => proyectarMinutos(-1)).toThrow(RangeError);
    expect(() => proyectarMinutos(1.5)).toThrow(RangeError);
  });
});

describe('suma mensual de minutos diarios', () => {
  it('30 s del lunes + 30 s del martes no son un minuto mensual', () => {
    const lunes = proyectarMinutos(30_000);
    const martes = proyectarMinutos(30_000);
    expect(sumarMinutosDiarios([lunes.minutosNetos, martes.minutosNetos])).toBe(0);
  });

  it('suma minutos ya proyectados sin volver a dividir la suma de ms', () => {
    const dia1 = proyectarMinutos(90_000); // 1 min + 30 s
    const dia2 = proyectarMinutos(90_000); // 1 min + 30 s
    expect(sumarMinutosDiarios([dia1.minutosNetos, dia2.minutosNetos])).toBe(2);
    // Dividir la suma de ms daría 3 minutos; el contrato pide 2.
    expect(Math.floor((dia1.msNetos + dia2.msNetos) / 60_000)).toBe(3);
  });
});

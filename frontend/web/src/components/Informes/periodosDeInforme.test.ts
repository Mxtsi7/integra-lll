import { describe, expect, it } from 'vitest';
import { resumenDePrueba } from '../../test/informesDePrueba';
import {
  MESES_DEL_INFORME,
  mesesDelInforme,
  montoComoNumero,
  montoLegible,
  nombreDelArchivoDeCobros,
  nombreDelMes,
  sinGastos,
} from './periodosDeInforme';

describe('los meses del informe (S3-CH-25)', () => {
  it('son seis: el elegido, que va al final, y los cinco anteriores', () => {
    expect(MESES_DEL_INFORME).toBe(6);
    expect(mesesDelInforme('2026-10')).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('cruzan el cambio de año sin saltarse un mes', () => {
    expect(mesesDelInforme('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('con otra cantidad, termina siempre en el mes elegido', () => {
    expect(mesesDelInforme('2026-10', 1)).toEqual(['2026-10']);
    expect(mesesDelInforme('2026-10', 3)).toEqual(['2026-08', '2026-09', '2026-10']);
  });
});

describe('nombre de un mes', () => {
  it('es el nombre completo, en español', () => {
    expect(nombreDelMes('2026-10')).toBe('octubre de 2026');
    expect(nombreDelMes('2026-01')).toBe('enero de 2026');
  });
});

describe('el monto de la API para mostrar', () => {
  it('se da con formato de la moneda', () => {
    expect(montoLegible('5900.00', 'CLP')).toBe('$5.900');
    expect(montoLegible('0.00', 'CLP')).toBe('$0');
  });

  it('con otra moneda lleva su propio formato, sin convertir', () => {
    expect(montoLegible('4.50', 'USD')).toMatch(/4,50/);
    expect(montoLegible('4.50', 'USD')).not.toBe(montoLegible('4.50', 'CLP'));
  });

  it('si no se le puede dar formato, se muestra tal cual y con su moneda', () => {
    expect(montoLegible('no es un número', 'CLP')).toBe('no es un número CLP');
    expect(montoLegible('5900.00', 'moneda inválida')).toBe('5900.00 moneda inválida');
  });
});

describe('el monto de la API como número', () => {
  it('lee el texto decimal', () => {
    expect(montoComoNumero('5900.00')).toBe(5900);
    expect(montoComoNumero('0.50')).toBe(0.5);
  });

  it('un texto que no es número no inventa una barra: cuenta como cero', () => {
    expect(montoComoNumero('abc')).toBe(0);
    expect(montoComoNumero('')).toBe(0);
  });
});

describe('sin gastos en los meses del informe', () => {
  const ceros = (periodo: string) => resumenDePrueba({ periodo, gasto_real: '0.00', gasto_proyectado: '0.00', total_estimado: '0.00' });

  it('es cierto cuando ningún mes tiene un cobro, real ni previsto', () => {
    expect(sinGastos([ceros('2026-09'), ceros('2026-10')])).toBe(true);
  });

  it('un solo cobro real en cualquier mes ya hay gastos', () => {
    expect(sinGastos([resumenDePrueba({ periodo: '2026-09' }), ceros('2026-10')])).toBe(false);
  });

  it('un cobro solo previsto también cuenta', () => {
    expect(sinGastos([ceros('2026-09'), resumenDePrueba({ periodo: '2026-10', gasto_real: '0.00', gasto_proyectado: '3000.00' })])).toBe(false);
  });

  it('sin ningún mes en la lista no dice nada: queda como sin gastos', () => {
    expect(sinGastos([])).toBe(true);
  });
});

describe('el nombre del archivo de cobros', () => {
  it('lleva el rango del mes y la moneda', () => {
    expect(nombreDelArchivoDeCobros('2026-10', 'CLP')).toBe('cobros_2026-10-01_2026-10-31_CLP.csv');
    expect(nombreDelArchivoDeCobros('2028-02', 'USD')).toBe('cobros_2028-02-01_2028-02-29_USD.csv');
  });

  it('la misma moneda en otro mes, o el mismo mes en otra moneda, no se confunden', () => {
    const nombres = new Set([
      nombreDelArchivoDeCobros('2026-10', 'CLP'),
      nombreDelArchivoDeCobros('2026-11', 'CLP'),
      nombreDelArchivoDeCobros('2026-10', 'USD'),
    ]);
    expect(nombres.size).toBe(3);
  });
});

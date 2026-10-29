import { describe, expect, it } from 'vitest';

import { conteoPorEstado, costoPorHora, equivalenteMensual, gastoProyectado, gastosPorMoneda, generaCobro } from './calculos';
import { SUSCRIPCIONES_DE_EJEMPLO } from './api/ejemplo';

describe('equivalenteMensual', () => {
  it('deja el mensual como está', () => {
    expect(equivalenteMensual(9990, 'mensual')).toBe(9990);
  });
  it('divide el anual en doce (RN-CIC-005)', () => {
    expect(equivalenteMensual(59990, 'anual')).toBeCloseTo(4999.17, 2);
  });
});

describe('costoPorHora', () => {
  it('reproduce el ejemplo del glosario: $9.900 en dos horas son $4.950 la hora', () => {
    expect(costoPorHora(9900, 2)).toBe(4950);
  });
  it('sin uso no hay costo por hora', () => {
    expect(costoPorHora(9900, 0)).toBeNull();
  });
});

describe('gastoProyectado', () => {
  it('separa monedas y evita que un consumidor antiguo las sume', () => {
    const clp = { ...SUSCRIPCIONES_DE_EJEMPLO[0], monto: 10000 };
    const usd = { ...clp, moneda: 'USD', monto: 4.99 };
    const eur = { ...clp, moneda: 'EUR', monto: 59.99, frecuencia: 'anual' as const };
    expect(gastosPorMoneda([clp, usd, usd, eur, { ...usd, estado: 'cancelado' }])).toEqual([
      { moneda: 'CLP', total: 10000 }, { moneda: 'USD', total: 9.98 }, { moneda: 'EUR', total: 5 },
    ]);
    expect(() => gastoProyectado([clp, usd])).toThrow(RangeError);
    expect(gastosPorMoneda([])).toEqual([]);
  });
  it('redondea el total después de sumar los equivalentes anuales', () => {
    const anual = { ...SUSCRIPCIONES_DE_EJEMPLO[0], monto: 0.01, frecuencia: 'anual' as const };
    expect(gastosPorMoneda(Array(12).fill(anual))).toEqual([{ moneda: anual.moneda, total: 0.01 }]);
  });
  it('suma activas, fantasmas y pruebas con monto, en equivalente mensual', () => {
    // activo 9990 + 4990 + 1290, fantasma 25000, prueba 6990. Excluye por_confirmar y cancelado.
    expect(gastoProyectado(SUSCRIPCIONES_DE_EJEMPLO)).toBe(9990 + 4990 + 1290 + 25000 + 6990);
  });
  it('una prueba sin fecha de término no entra', () => {
    const sinFecha = { ...SUSCRIPCIONES_DE_EJEMPLO[4], fin_prueba: undefined };
    expect(gastoProyectado([sinFecha])).toBe(0);
  });
});

describe('generaCobro (lo comparten el Panel y el Calendario)', () => {
  it('activas, fantasmas y pruebas con monto y término sí; por confirmar y canceladas no', () => {
    const porEstado = Object.fromEntries(SUSCRIPCIONES_DE_EJEMPLO.map((s) => [s.estado, generaCobro(s)]));
    expect(porEstado).toEqual({ activo: true, fantasma: true, prueba: true, por_confirmar: false, cancelado: false });
  });
  it('una prueba sin monto no genera cobro', () => {
    expect(generaCobro({ ...SUSCRIPCIONES_DE_EJEMPLO[4], monto: 0 })).toBe(false);
  });
});

describe('conteoPorEstado', () => {
  it('cuenta los cinco estados aunque alguno esté en cero', () => {
    expect(conteoPorEstado(SUSCRIPCIONES_DE_EJEMPLO)).toEqual({
      activo: 3, fantasma: 1, prueba: 1, por_confirmar: 1, cancelado: 1,
    });
  });
});

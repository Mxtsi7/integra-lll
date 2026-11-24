import { describe, expect, it } from 'vitest';
import { formatearMonto, type ComparacionDePresupuesto } from '@ojoalgasto/shared';
import {
  anchoDeLaBarra,
  esMontoCero,
  montoDelServidor,
  montoSinSigno,
  nombreDelMes,
  porcentajeLegible,
  situacionDelPresupuesto,
  tituloDelMes,
} from './presentacionDePresupuesto';

const comparacion = (parcial: Partial<ComparacionDePresupuesto>): ComparacionDePresupuesto => ({
  mes: '2026-11',
  moneda: 'CLP',
  presupuesto: '200000.00',
  gasto_real: '100000.00',
  gasto_proyectado: '50000.00',
  total_esperado: '150000.00',
  diferencia: '50000.00',
  porcentaje_consumido: 75,
  alerta_superado: false,
  ...parcial,
});

describe('el mes de un presupuesto (S3-CH-27)', () => {
  it('se dice con su nombre, y para títulos con mayúscula', () => {
    expect(nombreDelMes('2026-11')).toBe('noviembre de 2026');
    expect(tituloDelMes('2026-11')).toBe('Noviembre de 2026');
    expect(tituloDelMes('2027-01')).toBe('Enero de 2027');
  });
});

describe('los montos del servidor (S3-CH-27)', () => {
  it('se muestran con el formato de su moneda', () => {
    expect(montoDelServidor('200000.00', 'CLP')).toBe(formatearMonto(200000, 'CLP'));
    expect(montoDelServidor('4.50', 'USD')).toBe(formatearMonto(4.5, 'USD'));
  });

  it('un cero del servidor se muestra como cero', () => {
    expect(montoDelServidor('0.00', 'CLP')).toBe(formatearMonto(0, 'CLP'));
  });

  it('un monto que no es un número o vacío se muestra tal cual con su moneda, y no como un cero inventado', () => {
    expect(montoDelServidor('no es un número', 'CLP')).toBe('no es un número CLP');
    expect(montoDelServidor('', 'CLP')).toBe(' CLP');
    expect(montoDelServidor('', 'CLP')).not.toContain('0');
  });

  it('una moneda que Intl no entiende se muestra con el monto tal cual', () => {
    expect(montoDelServidor('5900.00', 'pesos')).toBe('5900.00 pesos');
  });

  it('el signo se quita solo al decir cuánto se pasó', () => {
    expect(montoSinSigno('-35000.00')).toBe('35000.00');
    expect(montoSinSigno('35000.00')).toBe('35000.00');
    expect(montoSinSigno('+5.00')).toBe('5.00');
  });

  it('un cero es cero; vacío o un texto no lo son', () => {
    expect(esMontoCero('0.00')).toBe(true);
    expect(esMontoCero('0')).toBe(true);
    expect(esMontoCero('0.01')).toBe(false);
    expect(esMontoCero('')).toBe(false);
    expect(esMontoCero('  ')).toBe(false);
    expect(esMontoCero('abc')).toBe(false);
  });
});

describe('el porcentaje consumido (S3-CH-27)', () => {
  it('se muestra con coma, hasta dos decimales y sin recortarlo a 100', () => {
    expect(porcentajeLegible(82.5)).toBe('82,5 %');
    expect(porcentajeLegible(75)).toBe('75 %');
    expect(porcentajeLegible(134.56)).toBe('134,56 %');
    expect(porcentajeLegible(0)).toBe('0 %');
  });

  it('la barra se llena hasta 100 aunque el porcentaje pase', () => {
    expect(anchoDeLaBarra(82.5)).toBe(82.5);
    expect(anchoDeLaBarra(134.56)).toBe(100);
    expect(anchoDeLaBarra(100)).toBe(100);
  });

  it('la barra queda vacía con 0, negativo o algo que no es un número', () => {
    expect(anchoDeLaBarra(0)).toBe(0);
    expect(anchoDeLaBarra(-5)).toBe(0);
    expect(anchoDeLaBarra(Number.NaN)).toBe(0);
    expect(anchoDeLaBarra(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('la situación del presupuesto (S3-CH-27)', () => {
  it('sin presupuesto definido, aunque haya gasto', () => {
    expect(situacionDelPresupuesto(comparacion({ presupuesto: null, diferencia: null, porcentaje_consumido: 0 }))).toBe('sin_presupuesto');
  });

  it('con presupuesto y sin alerta del servidor, está dentro', () => {
    expect(situacionDelPresupuesto(comparacion({}))).toBe('dentro_del_presupuesto');
  });

  it('con presupuesto y la alerta del servidor, está superado', () => {
    expect(situacionDelPresupuesto(comparacion({ alerta_superado: true, diferencia: '-10.00', porcentaje_consumido: 105 }))).toBe(
      'presupuesto_superado',
    );
  });

  it('lo decide la alerta del servidor, no una cuenta de la web con los montos', () => {
    // Con montos que la web vería como "superado" pero sin la alerta del servidor, no se contradice al servidor.
    expect(situacionDelPresupuesto(comparacion({ total_esperado: '999999.00', alerta_superado: false }))).toBe('dentro_del_presupuesto');
  });

  it('un gasto de cero con presupuesto está dentro, no sin presupuesto', () => {
    const sinGasto = comparacion({ gasto_real: '0.00', gasto_proyectado: '0.00', total_esperado: '0.00', diferencia: '200000.00', porcentaje_consumido: 0 });
    expect(situacionDelPresupuesto(sinGasto)).toBe('dentro_del_presupuesto');
  });
});

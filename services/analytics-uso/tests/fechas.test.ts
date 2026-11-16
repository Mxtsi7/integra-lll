import { describe, expect, it } from 'vitest';

import { ErrorValidacionUso } from '../src/dominio/errores';
import {
  fechaLocalDe,
  formatearUtc,
  parsearUtc,
  validarDiaLocalUnico,
  validarZonaHoraria,
} from '../src/dominio/fechas';

function capturarCodigo(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ErrorValidacionUso) return error.codigo;
    throw error;
  }
  throw new Error('se esperaba ErrorValidacionUso');
}

describe('instantes UTC', () => {
  it('acepta segundos y hasta tres decimales', () => {
    expect(parsearUtc('2026-11-09T12:00:00Z').toISOString()).toBe(
      '2026-11-09T12:00:00.000Z',
    );
    expect(parsearUtc('2026-11-09T12:00:00.5Z').toISOString()).toBe(
      '2026-11-09T12:00:00.500Z',
    );
    expect(formatearUtc(parsearUtc('2026-11-09T12:00:00.123Z'))).toBe(
      '2026-11-09T12:00:00.123Z',
    );
  });

  it('rechaza fechas imposibles que Date normalizaría', () => {
    expect(capturarCodigo(() => parsearUtc('2026-02-30T00:00:00Z'))).toBe(
      'evento_invalido',
    );
  });

  it('rechaza horas fuera de rango y falta de Z', () => {
    expect(capturarCodigo(() => parsearUtc('2026-11-09T24:00:00Z'))).toBe(
      'evento_invalido',
    );
    expect(capturarCodigo(() => parsearUtc('2026-11-09T12:00:00+00:00'))).toBe(
      'evento_invalido',
    );
  });
});

describe('día local', () => {
  it('resuelve la medianoche local de America/Santiago', () => {
    const inicio = parsearUtc('2026-11-09T03:00:00Z');
    const fin = parsearUtc('2026-11-10T03:00:00Z');
    expect(fechaLocalDe(inicio, 'America/Santiago')).toBe('2026-11-09');
    expect(validarDiaLocalUnico(inicio, fin, 'America/Santiago')).toBe('2026-11-09');
  });

  it('acepta un día local de 25 h por cambio de horario, sin sumar 24 h', () => {
    const inicio = parsearUtc('2026-11-01T04:00:00Z');
    const fin = parsearUtc('2026-11-02T05:00:00Z');
    expect(validarDiaLocalUnico(inicio, fin, 'America/New_York')).toBe('2026-11-01');
  });

  it('rechaza una ventana que cruza la medianoche local', () => {
    const inicio = parsearUtc('2026-11-09T12:00:00Z');
    const fin = parsearUtc('2026-11-10T12:00:00Z');
    expect(capturarCodigo(() => validarDiaLocalUnico(inicio, fin, 'America/Santiago'))).toBe(
      'intervalo_cruza_dia_local',
    );
  });

  it('rechaza una zona IANA inexistente', () => {
    expect(capturarCodigo(() => validarZonaHoraria('Marte/Olympus'))).toBe(
      'evento_invalido',
    );
  });

  it('rechaza una ventana vacía', () => {
    const instante = parsearUtc('2026-11-09T12:00:00Z');
    expect(
      capturarCodigo(() => validarDiaLocalUnico(instante, instante, 'America/Santiago')),
    ).toBe('detalle_actividad_invalido');
  });
});

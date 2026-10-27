import { describe, expect, it, vi } from 'vitest';
import { vistaDeEstado, type EstadoCarga } from './estadoCarga';

describe('vistaDeEstado', () => {
  it('cargando → cargando', () => {
    expect(vistaDeEstado({ tipo: 'cargando' })).toBe('cargando');
  });

  it('error → error', () => {
    expect(vistaDeEstado({ tipo: 'error' })).toBe('error');
  });

  it('listo con datos → listo', () => {
    expect(vistaDeEstado({ tipo: 'listo', datos: ['a'] }, (d) => d.length === 0)).toBe('listo');
  });

  it('listo sin criterio de vacío → listo', () => {
    expect(vistaDeEstado({ tipo: 'listo', datos: [] as string[] })).toBe('listo');
  });

  it('listo pero vacío → vacio', () => {
    expect(vistaDeEstado({ tipo: 'listo', datos: [] as string[] }, (d) => d.length === 0)).toBe('vacio');
  });

  it('no evalúa esVacio mientras carga ni tras un error', () => {
    const esVacio = vi.fn(() => true);
    vistaDeEstado<string[]>({ tipo: 'cargando' }, esVacio);
    vistaDeEstado<string[]>({ tipo: 'error' }, esVacio);
    expect(esVacio).not.toHaveBeenCalled();
  });

  it('pasar de listo a error no conserva el dato anterior', () => {
    let estado: EstadoCarga<string[]> = { tipo: 'listo', datos: ['privado'] };
    expect(vistaDeEstado(estado)).toBe('listo');
    estado = { tipo: 'error' };
    expect('datos' in estado).toBe(false);
    expect(vistaDeEstado(estado)).toBe('error');
  });
});

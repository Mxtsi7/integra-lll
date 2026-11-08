import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import { descartarRecomendacion, getRecomendaciones } from './recomendaciones';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

describe('getRecomendaciones (AN-20)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset();
  });

  it('pide GET /recomendaciones/ y devuelve el arreglo tal cual', async () => {
    const lista = [{ id: 'r1', suscripcion_id: 's1', motivo: 'Duplicada', ahorro_estimado: 5000, moneda: 'CLP' }];
    vi.mocked(pedir).mockResolvedValue(lista);
    await expect(getRecomendaciones()).resolves.toEqual(lista);
    expect(pedir).toHaveBeenCalledWith('/recomendaciones/');
  });

  it('acepta también la forma paginada { results }', async () => {
    vi.mocked(pedir).mockResolvedValue({ results: [{ id: 'r2' }] });
    await expect(getRecomendaciones()).resolves.toEqual({ results: [{ id: 'r2' }] });
  });

  it('propaga el error de la API sin tragárselo', async () => {
    vi.mocked(pedir).mockRejectedValue(new Error('boom'));
    await expect(getRecomendaciones()).rejects.toThrow('boom');
  });
});

describe('descartarRecomendacion (CH-32, VI-18)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset();
  });

  it('manda POST /recomendaciones/<id>/dismiss/ sin cuerpo y devuelve la confirmación', async () => {
    const confirmacion = { recomendacion_id: 'r1', vigente_hasta: '2026-11-27T12:00:00Z', descartado: true };
    vi.mocked(pedir).mockResolvedValue(confirmacion);
    await expect(descartarRecomendacion('r1')).resolves.toEqual(confirmacion);
    expect(pedir).toHaveBeenCalledWith('/recomendaciones/r1/dismiss/', { method: 'POST' });
  });

  it('codifica el id para que no rompa la ruta', async () => {
    vi.mocked(pedir).mockResolvedValue({});
    await descartarRecomendacion('a/b?c');
    expect(pedir).toHaveBeenCalledWith('/recomendaciones/a%2Fb%3Fc/dismiss/', { method: 'POST' });
  });
});

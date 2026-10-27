import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import { getRecomendaciones } from './recomendaciones';

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

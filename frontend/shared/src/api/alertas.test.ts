import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import {
  getAlertas,
  getContadorAlertas,
  marcarAlertaLeida,
  marcarTodasLasAlertasLeidas,
  TAMANO_PAGINA_ALERTAS,
} from './alertas';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

describe('alertas (CH-31, FE-19, FE-20)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset().mockResolvedValue({});
  });

  it('el listado pide la página y su tamaño, y sin filtro no manda lectura', async () => {
    await getAlertas();
    expect(pedir).toHaveBeenCalledWith(`/alertas/?page=1&page_size=${TAMANO_PAGINA_ALERTAS}`);
    await getAlertas({ pagina: 3 });
    expect(pedir).toHaveBeenLastCalledWith(`/alertas/?page=3&page_size=${TAMANO_PAGINA_ALERTAS}`);
  });

  it.each(['pendiente', 'leida', 'revisada'] as const)('con lectura=%s filtra en el servidor', async (lectura) => {
    await getAlertas({ lectura, pagina: 2 });
    expect(pedir).toHaveBeenCalledWith(`/alertas/?page=2&page_size=${TAMANO_PAGINA_ALERTAS}&lectura=${lectura}`);
  });

  it('el contador es un GET a /alertas/contador/', async () => {
    vi.mocked(pedir).mockResolvedValue({ pendientes: 2, total: 5 });
    await expect(getContadorAlertas()).resolves.toEqual({ pendientes: 2, total: 5 });
    expect(pedir).toHaveBeenCalledWith('/alertas/contador/');
  });

  it('marcar una como leída es un POST sin cuerpo a …/leer/, con el id codificado', async () => {
    await marcarAlertaLeida('a-1');
    expect(pedir).toHaveBeenCalledWith('/alertas/a-1/leer/', { method: 'POST' });
    await marcarAlertaLeida('a/b?c');
    expect(pedir).toHaveBeenLastCalledWith('/alertas/a%2Fb%3Fc/leer/', { method: 'POST' });
  });

  it('marcar todas es un POST a /alertas/leer-todas/ y devuelve cuántas cambiaron', async () => {
    vi.mocked(pedir).mockResolvedValue({ leidas: 4 });
    await expect(marcarTodasLasAlertasLeidas()).resolves.toEqual({ leidas: 4 });
    expect(pedir).toHaveBeenCalledWith('/alertas/leer-todas/', { method: 'POST' });
  });

  it('un error de la API se propaga', async () => {
    const error = new Error('No encontrado.');
    vi.mocked(pedir).mockRejectedValue(error);
    await expect(marcarAlertaLeida('a-1')).rejects.toBe(error);
    await expect(getAlertas()).rejects.toBe(error);
  });
});

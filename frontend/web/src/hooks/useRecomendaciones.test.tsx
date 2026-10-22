// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pedir } from '../../../shared/src/api/cliente';
import { useRecomendaciones } from './useRecomendaciones';

vi.mock('../../../shared/src/api/cliente', () => ({ pedir: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('contrato de recomendaciones pendiente de VI-17', () => {
  const item = { id: 'rec-1', suscripcion_id: 'sub-2', titulo: 'Revisar servicio' };
  it.each([{ respuesta: [item] }, { respuesta: { count: 1, results: [item] } }])('conserva los datos recibidos: %j', async ({ respuesta }) => {
    vi.mocked(pedir).mockResolvedValue(respuesta);
    const { result } = renderHook(useRecomendaciones);
    await waitFor(() => expect(result.current.estado).toEqual({ tipo: 'listo', items: [item] }));
    expect(pedir).toHaveBeenCalledWith('/recomendaciones/');
  });

  it('solo informa vacío cuando la API devuelve una lista vacía', async () => {
    vi.mocked(pedir).mockResolvedValue({ count: 0, results: [] });
    const { result } = renderHook(useRecomendaciones);
    await waitFor(() => expect(result.current.estado).toEqual({ tipo: 'listo', items: [] }));
  });

  it('un formato desconocido no se convierte en vacío de negocio', async () => {
    vi.mocked(pedir).mockResolvedValue({ detalle: 'respuesta inesperada' });
    const { result } = renderHook(useRecomendaciones);
    await waitFor(() => expect(result.current.estado.tipo).toBe('error'));
  });

  it('una dependencia no disponible se muestra como error', async () => {
    vi.mocked(pedir).mockRejectedValue(new Error('Servicio no disponible'));
    const { result } = renderHook(useRecomendaciones);
    await waitFor(() => expect(result.current.estado).toEqual({ tipo: 'error', mensaje: 'Servicio no disponible' }));
  });
});

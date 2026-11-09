// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pedir } from '../../../shared/src/api/cliente';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { useRecomendaciones } from './useRecomendaciones';

vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

// El hook anota la sesión con la que se montó (revisión de #128): necesita el AuthProvider real.
function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
const montarHook = () => renderHook(useRecomendaciones, { wrapper: Proveedores });

describe('contrato de recomendaciones de VI-17', () => {
  const item = { id: 'rec-1', suscripcion_id: 'sub-2', titulo: 'Revisar servicio' };
  it.each([{ respuesta: [item] }, { respuesta: { count: 1, results: [item] } }])('conserva los datos recibidos: %j', async ({ respuesta }) => {
    vi.mocked(pedir).mockResolvedValue(respuesta);
    const { result } = montarHook();
    await waitFor(() =>
      expect(result.current.estado).toEqual({ tipo: 'listo', items: [item], disponible: true, motivoSinSugerencias: null }),
    );
    expect(pedir).toHaveBeenCalledWith('/recomendaciones/');
  });

  it('solo informa vacío cuando la API devuelve una lista vacía, con el motivo que da', async () => {
    vi.mocked(pedir).mockResolvedValue({
      results: [],
      total: 0,
      disponible: true,
      motivo_sin_sugerencias: 'Todavía no hay recomendaciones de consolidación generadas.',
    });
    const { result } = montarHook();
    await waitFor(() =>
      expect(result.current.estado).toEqual({
        tipo: 'listo',
        items: [],
        disponible: true,
        motivoSinSugerencias: 'Todavía no hay recomendaciones de consolidación generadas.',
      }),
    );
  });

  it('sin umbral configurado (disponible: false) no se confunde con "no hay sugerencias"', async () => {
    vi.mocked(pedir).mockResolvedValue({ results: [], disponible: false, motivo_sin_sugerencias: 'No hay umbral.' });
    const { result } = montarHook();
    await waitFor(() => expect(result.current.estado).toMatchObject({ tipo: 'listo', disponible: false }));
  });

  it('un formato desconocido no se convierte en vacío de negocio', async () => {
    vi.mocked(pedir).mockResolvedValue({ detalle: 'respuesta inesperada' });
    const { result } = montarHook();
    await waitFor(() => expect(result.current.estado.tipo).toBe('error'));
  });

  it('una dependencia no disponible se muestra como error', async () => {
    vi.mocked(pedir).mockRejectedValue(new Error('Servicio no disponible'));
    const { result } = montarHook();
    await waitFor(() => expect(result.current.estado).toEqual({ tipo: 'error', mensaje: 'Servicio no disponible' }));
  });

  it('si se reintenta antes de que llegue la carga anterior, la respuesta vieja no se muestra', async () => {
    let responderVieja: (v: unknown) => void = () => {};
    vi.mocked(pedir)
      .mockReturnValueOnce(new Promise((r) => (responderVieja = r)))
      .mockResolvedValueOnce({ results: [] });
    const { result } = montarHook();
    await act(async () => result.current.recargar());
    await act(async () => responderVieja({ results: [item] }));
    expect(result.current.estado).toMatchObject({ tipo: 'listo', items: [] });
  });
});

describe('descartar (CH-32, VI-18)', () => {
  const A = { id: 'rec-a', nombre: 'Netflix' };
  const B = { id: 'rec-b', nombre: 'Spotify' };

  async function montarCon(items: unknown[]) {
    vi.mocked(pedir).mockResolvedValueOnce({ results: items });
    const hook = montarHook();
    await waitFor(() => expect(hook.result.current.estado.tipo).toBe('listo'));
    return hook;
  }

  it('manda POST .../dismiss/ sin cuerpo y retira la tarjeta solo cuando el servidor confirma', async () => {
    let confirmar: (v: unknown) => void = () => {};
    const { result } = await montarCon([A, B]);
    vi.mocked(pedir).mockReturnValueOnce(new Promise((r) => (confirmar = r)));

    let descarte!: Promise<unknown>;
    act(() => {
      descarte = result.current.descartar('rec-a');
    });
    expect(pedir).toHaveBeenLastCalledWith('/recomendaciones/rec-a/dismiss/', { method: 'POST' });
    expect(result.current.descartes['rec-a']).toEqual({ tipo: 'enviando' });
    expect(result.current.estado).toMatchObject({ items: [A, B] }); // todavía no

    await act(async () => {
      confirmar({ recomendacion_id: 'rec-a', vigente_hasta: '2026-11-27T12:00:00Z', descartado: true });
      await descarte;
    });
    expect(result.current.estado).toMatchObject({ items: [B] });
    expect(result.current.descartes['rec-a']).toBeUndefined();
  });

  it('si falla, la recomendación se queda con el error y se puede reintentar', async () => {
    const { result } = await montarCon([A, B]);
    vi.mocked(pedir).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => {
      await result.current.descartar('rec-a');
    });
    expect(result.current.estado).toMatchObject({ items: [A, B] });
    expect(result.current.descartes['rec-a']).toEqual({
      tipo: 'error',
      mensaje: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    });

    vi.mocked(pedir).mockResolvedValueOnce({ recomendacion_id: 'rec-a', vigente_hasta: null, descartado: true });
    await act(async () => {
      await result.current.descartar('rec-a');
    });
    expect(result.current.estado).toMatchObject({ items: [B] });
    expect(result.current.descartes['rec-a']).toBeUndefined();
  });

  it('dos clics en el mismo instante mandan un solo descarte', async () => {
    const { result } = await montarCon([A]);
    vi.mocked(pedir).mockResolvedValue({ recomendacion_id: 'rec-a', vigente_hasta: null, descartado: true });
    await act(async () => {
      await Promise.all([result.current.descartar('rec-a'), result.current.descartar('rec-a')]);
    });
    const descartes = vi.mocked(pedir).mock.calls.filter(([ruta]) => String(ruta).endsWith('/dismiss/'));
    expect(descartes).toHaveLength(1);
  });

  it('una carga respondida antes de guardar el descarte no la vuelve a mostrar', async () => {
    const { result } = await montarCon([A, B]);
    let cargaVieja: (v: unknown) => void = () => {};
    vi.mocked(pedir)
      .mockReturnValueOnce(new Promise((r) => (cargaVieja = r))) // recargar
      .mockResolvedValueOnce({ recomendacion_id: 'rec-a', vigente_hasta: null, descartado: true }); // descartar
    act(() => {
      void result.current.recargar();
    });
    await act(async () => {
      await result.current.descartar('rec-a');
    });
    await act(async () => cargaVieja({ results: [A, B] })); // el servidor la respondió antes del descarte
    expect(result.current.estado).toMatchObject({ tipo: 'listo', items: [B] });
  });

  it('un 404 se explica sin decir que se descartó', async () => {
    const { ErrorDeApi } = await import('../../../shared/src/api/cliente');
    const { result } = await montarCon([A]);
    vi.mocked(pedir).mockRejectedValueOnce(new ErrorDeApi('Recomendación no encontrada.', 404));
    await act(async () => {
      expect(await result.current.descartar('rec-a')).toBeNull();
    });
    expect(result.current.descartes['rec-a']).toEqual({
      tipo: 'error',
      mensaje: 'Esta recomendación ya no está disponible. Vuelve a cargar la lista.',
    });
    expect(result.current.estado).toMatchObject({ items: [A] });
  });
});

describe('explicación (CH-22, MX-25)', () => {
  const DE_NETFLIX = { id: 'rec-a', nombre: 'Netflix' };
  const DE_SPOTIFY = { id: 'rec-b', nombre: 'Spotify' };
  // La forma real de MX-25 (ExplicacionSerializer).
  const EXPLICACION_DE_NETFLIX = {
    id: 'rec-a',
    suscripcion_id: 'sub-a',
    explicacion: 'Pagas dos planes parecidos. Es una estimación, no un ahorro confirmado.',
    fuente: 'reglas',
    estado: 'disponible',
    motivo: 'Pagas dos planes parecidos.',
    ahorro_estimado: 5000,
    moneda: 'CLP',
    base_calculo: 'el plan más barato',
    evidencia: null,
    uso: 'no_evaluado',
    advertencia_uso: 'La consolidación se basa en solapamiento; no afirma bajo uso.',
  };

  async function montarCon(items: unknown[]) {
    vi.mocked(pedir).mockResolvedValueOnce({ results: items });
    const hook = montarHook();
    await waitFor(() => expect(hook.result.current.estado.tipo).toBe('listo'));
    return hook;
  }

  it('pide GET .../explicar/ y la guarda cuando llega, sin tocar la lista', async () => {
    let responder: (respuesta: unknown) => void = () => {};
    const { result } = await montarCon([DE_NETFLIX, DE_SPOTIFY]);
    vi.mocked(pedir).mockReturnValueOnce(new Promise((resolver) => (responder = resolver)));

    let carga!: Promise<unknown>;
    act(() => {
      carga = result.current.cargarExplicacion('rec-a');
    });
    expect(pedir).toHaveBeenLastCalledWith('/recomendaciones/rec-a/explicar/');
    expect(result.current.explicaciones['rec-a']).toEqual({ tipo: 'cargando' });

    await act(async () => {
      responder(EXPLICACION_DE_NETFLIX);
      await carga;
    });
    expect(result.current.explicaciones['rec-a']).toEqual({ tipo: 'listo', explicacion: EXPLICACION_DE_NETFLIX });
    expect(result.current.explicaciones['rec-b']).toBeUndefined();
    expect(result.current.estado).toMatchObject({ items: [DE_NETFLIX, DE_SPOTIFY] });
  });

  it('dos pedidos en el mismo instante mandan una sola petición', async () => {
    const { result } = await montarCon([DE_NETFLIX]);
    vi.mocked(pedir).mockResolvedValue(EXPLICACION_DE_NETFLIX);
    await act(async () => {
      await Promise.all([result.current.cargarExplicacion('rec-a'), result.current.cargarExplicacion('rec-a')]);
    });
    const pedidos = vi.mocked(pedir).mock.calls.filter(([ruta]) => String(ruta).endsWith('/explicar/'));
    expect(pedidos).toHaveLength(1);
  });

  it('si falla queda el error y se puede volver a pedir', async () => {
    const { result } = await montarCon([DE_NETFLIX]);
    vi.mocked(pedir).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => {
      await result.current.cargarExplicacion('rec-a');
    });
    expect(result.current.explicaciones['rec-a']).toEqual({
      tipo: 'error',
      mensaje: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    });

    vi.mocked(pedir).mockResolvedValueOnce(EXPLICACION_DE_NETFLIX);
    await act(async () => {
      await result.current.cargarExplicacion('rec-a');
    });
    expect(result.current.explicaciones['rec-a']).toEqual({ tipo: 'listo', explicacion: EXPLICACION_DE_NETFLIX });
  });

  it.each([
    [404, 'Esta recomendación ya no está disponible. Vuelve a cargar la lista.'],
    [500, 'No pudimos cargar la explicación. Intenta de nuevo.'],
  ])('un %i se explica sin inventar una explicación', async (status, mensaje) => {
    const { ErrorDeApi } = await import('../../../shared/src/api/cliente');
    const { result } = await montarCon([DE_NETFLIX]);
    vi.mocked(pedir).mockRejectedValueOnce(new ErrorDeApi('Error del servicio.', status));
    await act(async () => {
      await result.current.cargarExplicacion('rec-a');
    });
    expect(result.current.explicaciones['rec-a']).toEqual({ tipo: 'error', mensaje });
  });

  it('una explicación que llega después de recargar la lista no se aplica', async () => {
    const { result } = await montarCon([DE_NETFLIX]);
    let explicacionVieja: (respuesta: unknown) => void = () => {};
    vi.mocked(pedir)
      .mockReturnValueOnce(new Promise((resolver) => (explicacionVieja = resolver))) // explicar
      .mockResolvedValueOnce({ results: [DE_NETFLIX] }); // recargar
    act(() => {
      void result.current.cargarExplicacion('rec-a');
    });
    await act(async () => {
      await result.current.recargar();
    });
    await act(async () => explicacionVieja(EXPLICACION_DE_NETFLIX));
    expect(result.current.explicaciones).toEqual({});
  });

  it('descartar la recomendación borra su explicación', async () => {
    const { result } = await montarCon([DE_NETFLIX, DE_SPOTIFY]);
    vi.mocked(pedir)
      .mockResolvedValueOnce(EXPLICACION_DE_NETFLIX)
      .mockResolvedValueOnce({ recomendacion_id: 'rec-a', vigente_hasta: null, descartado: true });
    await act(async () => {
      await result.current.cargarExplicacion('rec-a');
    });
    expect(result.current.explicaciones['rec-a']).toMatchObject({ tipo: 'listo' });

    await act(async () => {
      await result.current.descartar('rec-a');
    });
    expect(result.current.explicaciones['rec-a']).toBeUndefined();
  });
});

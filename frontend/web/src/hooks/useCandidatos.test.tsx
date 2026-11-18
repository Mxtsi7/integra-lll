// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from '../../../shared/src/api/cliente';
import { guardarTokens } from '../../../shared/src/auth';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import { MENSAJE_ERROR_CANDIDATOS, useCandidatos } from './useCandidatos';

// Solo se simula la red (pedir). El hook y el AuthProvider son los reales.
vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});

const TOKEN_DE_A = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const TOKEN_DE_B = crearTokenDePrueba({ user_id: 8, organizacion_id: 'org-b', sid: 'sesion-b', jti: 'b-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };
const PAGINA_VACIA = { count: 0, next: null, previous: null, results: [] };

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

/** Responde /usuarios/me/ con la persona actual y deja que el test decida qué responde la lista. */
function simularRed(respuestaDeCandidatos: (ruta: string) => Promise<unknown>) {
  vi.mocked(pedir).mockImplementation((ruta: string) =>
    ruta.startsWith('/candidatos/') ? respuestaDeCandidatos(ruta) : Promise.resolve(PERSONA_ACTUAL),
  );
}
const pedidosDeCandidatos = () => vi.mocked(pedir).mock.calls.filter(([ruta]) => String(ruta).startsWith('/candidatos/'));

/** Otra pestaña guarda los tokens de B: a esta solo le llega el evento `storage`. */
const entraOtraSesion = () =>
  act(async () => {
    guardarTokens({ access_token: TOKEN_DE_B, refresh_token: 'refresh-b' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
  });

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((alResolver, alRechazar) => {
    resolver = alResolver;
    rechazar = alRechazar;
  });
  return { promesa, resolver, rechazar };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset();
  guardarTokens({ access_token: TOKEN_DE_A, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('carga de la lista de candidatos (S3-CH-04)', () => {
  it('empieza cargando y luego entrega la primera página con los filtros que se pidieron', async () => {
    simularRed(async () => PAGINA_VACIA);

    const { result } = renderHook(() => useCandidatos({ origen: 'csv' }), { wrapper: Proveedores });

    expect(result.current.carga).toEqual({ tipo: 'cargando' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    expect(pedidosDeCandidatos()).toEqual([['/candidatos/?page=1&page_size=10&origen=csv']]);
    expect(result.current.pagina).toBe(1);
  });

  it('sin red no deja datos de antes y dice que no hay conexión', async () => {
    simularRed(() => Promise.reject(new TypeError('Failed to fetch')));

    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });

    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));
    expect(result.current.carga).toEqual({ tipo: 'error', mensaje: MENSAJE_SIN_RED });
  });

  it('cualquier otro fallo del servidor da el mensaje general de la lista', async () => {
    simularRed(() => Promise.reject(new ErrorDeApi('Error interno.', 500)));

    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });

    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));
    expect(result.current.carga).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_CANDIDATOS });
  });

  it('recargar vuelve a pedir la misma página', async () => {
    simularRed(async () => PAGINA_VACIA);
    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    act(() => result.current.recargar());

    await waitFor(() => expect(pedidosDeCandidatos()).toHaveLength(2));
    expect(pedidosDeCandidatos()[1]).toEqual(pedidosDeCandidatos()[0]);
  });

  it('recargar reemplaza la página en vez de sumarla: los mismos cobros no aparecen dos veces (criterio de S3-CH-04)', async () => {
    const paginaConDos = { count: 2, next: null, previous: null, results: [{ id: 'c-1' }, { id: 'c-2' }] };
    simularRed(async () => paginaConDos);
    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    act(() => result.current.recargar());
    await waitFor(() => expect(pedidosDeCandidatos()).toHaveLength(2));
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(result.current.carga).toEqual({ tipo: 'listo', datos: paginaConDos });
  });

  it('si la página que se veía ya no existe (404), vuelve a la anterior en vez de quedar en un error', async () => {
    simularRed(async (ruta) => {
      if (ruta.includes('page=3')) throw new ErrorDeApi('Página inválida.', 404);
      return PAGINA_VACIA;
    });
    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    act(() => result.current.irAPagina(3));

    await waitFor(() => expect(result.current.pagina).toBe(2));
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    expect(pedidosDeCandidatos().map(([ruta]) => ruta)).toEqual([
      '/candidatos/?page=1&page_size=10',
      '/candidatos/?page=3&page_size=10',
      '/candidatos/?page=2&page_size=10',
    ]);
  });

  it('un 404 en la página 1 sí es un error: no hay a dónde volver', async () => {
    simularRed(() => Promise.reject(new ErrorDeApi('Ruta desconocida', 404)));

    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });

    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));
    expect(result.current.carga).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_CANDIDATOS });
    expect(pedidosDeCandidatos()).toHaveLength(1);
  });

  it('mientras llega otra página no queda visible la anterior: vuelve a cargando', async () => {
    const paginaDos = diferida<unknown>();
    simularRed((ruta) => (ruta.includes('page=2') ? paginaDos.promesa : Promise.resolve(PAGINA_VACIA)));
    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    act(() => result.current.irAPagina(2));

    await waitFor(() => expect(pedidosDeCandidatos()).toHaveLength(2));
    expect(result.current.carga).toEqual({ tipo: 'cargando' });
    await act(async () => paginaDos.resolver(PAGINA_VACIA));
    expect(result.current.carga.tipo).toBe('listo');
  });

  it('irAPagina pide esa página al servidor', async () => {
    simularRed(async () => PAGINA_VACIA);
    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    act(() => result.current.irAPagina(3));

    await waitFor(() => expect(result.current.pagina).toBe(3));
    expect(pedidosDeCandidatos().at(-1)).toEqual(['/candidatos/?page=3&page_size=10']);
  });

  it('cambiar un filtro vuelve a la página 1, aunque se estuviera en otra', async () => {
    simularRed(async () => PAGINA_VACIA);
    const { result, rerender } = renderHook(({ origen }: { origen?: 'csv' | 'correo' }) => useCandidatos({ origen }), {
      wrapper: Proveedores,
      initialProps: { origen: 'csv' as 'csv' | 'correo' },
    });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.irAPagina(4));
    await waitFor(() => expect(result.current.pagina).toBe(4));

    rerender({ origen: 'correo' });

    await waitFor(() => expect(pedidosDeCandidatos().at(-1)).toEqual(['/candidatos/?page=1&page_size=10&origen=correo']));
    expect(result.current.pagina).toBe(1);
  });
});

describe('cambio de sesión con la lista montada (regla de sesión de Integra III)', () => {
  it('la respuesta de A que llega después de entrar B no se muestra', async () => {
    const respuestaDeA = diferida<unknown>();
    simularRed(() => respuestaDeA.promesa);
    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });
    await waitFor(() => expect(pedidosDeCandidatos()).toHaveLength(1));

    await entraOtraSesion();
    await act(async () => respuestaDeA.resolver(PAGINA_VACIA));

    expect(result.current.carga.tipo).toBe('cargando');
  });

  it('un error de A que llega tarde no aparece en la vista de B', async () => {
    const falloDeA = diferida<unknown>();
    simularRed(() => falloDeA.promesa);
    const { result } = renderHook(() => useCandidatos(), { wrapper: Proveedores });
    await waitFor(() => expect(pedidosDeCandidatos()).toHaveLength(1));

    await entraOtraSesion();
    await act(async () => falloDeA.rechazar(new TypeError('Failed to fetch')));

    expect(result.current.carga.tipo).toBe('cargando');
  });
});

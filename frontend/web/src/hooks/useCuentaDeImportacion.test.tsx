// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCuentasConectadas, type CuentaConectada } from '@ojoalgasto/shared';
import { guardarTokens } from '../../../shared/src/auth';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { useCuentaDeImportacion } from './useCuentaDeImportacion';

// Solo se simula la consulta de cuentas. El hook y el AuthProvider son los reales.
vi.mock('@ojoalgasto/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ojoalgasto/shared')>();
  return { ...real, getCuentasConectadas: vi.fn() };
});

const TOKEN_DE_A = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const TOKEN_DE_B = crearTokenDePrueba({ user_id: 8, organizacion_id: 'org-b', sid: 'sesion-b', jti: 'b-1' });

const cuentaDe = (id: string, parcial: Partial<CuentaConectada> = {}): CuentaConectada => ({
  id,
  proveedor: 'gmail',
  proveedor_legible: 'Gmail',
  cuenta_externa: `${id}@ejemplo.test`,
  estado: 'conectada',
  estado_legible: 'Conectada',
  detalle_del_estado: '',
  necesita_reautorizacion: false,
  token_expira_en: null,
  ultima_sincronizacion: null,
  creado_en: '2026-10-01T10:00:00-03:00',
  actualizado_en: '2026-11-01T10:00:00-03:00',
  ...parcial,
});

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

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
  vi.mocked(getCuentasConectadas).mockReset();
  guardarTokens({ access_token: TOKEN_DE_A, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('la cuenta de una importación de correo (S3-CH-22)', () => {
  it('sin cuenta no pide nada y dice que no hay cuenta', () => {
    const { result } = renderHook(() => useCuentaDeImportacion(null), { wrapper: Proveedores });

    expect(result.current).toEqual({ tipo: 'sin-cuenta' });
    expect(getCuentasConectadas).not.toHaveBeenCalled();
  });

  it('empieza cargando y entrega la cuenta con ese id, con lo que el backend dice de ella', async () => {
    vi.mocked(getCuentasConectadas).mockResolvedValue([cuentaDe('cta-1'), cuentaDe('cta-2', { necesita_reautorizacion: true })]);

    const { result } = renderHook(() => useCuentaDeImportacion('cta-2'), { wrapper: Proveedores });
    expect(result.current).toEqual({ tipo: 'cargando' });
    await waitFor(() => expect(result.current.tipo).toBe('listo'));

    expect(result.current).toEqual({ tipo: 'listo', cuenta: cuentaDe('cta-2', { necesita_reautorizacion: true }) });
    expect(getCuentasConectadas).toHaveBeenCalledTimes(1);
  });

  it('una cuenta que ya no está en el listado se entrega como ausente, no como un error', async () => {
    vi.mocked(getCuentasConectadas).mockResolvedValue([cuentaDe('cta-1')]);

    const { result } = renderHook(() => useCuentaDeImportacion('cta-borrada'), { wrapper: Proveedores });
    await waitFor(() => expect(result.current.tipo).toBe('listo'));

    expect(result.current).toEqual({ tipo: 'listo', cuenta: null });
  });

  it('si no se pudieron consultar las cuentas, lo dice como error y no inventa una cuenta', async () => {
    vi.mocked(getCuentasConectadas).mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useCuentaDeImportacion('cta-1'), { wrapper: Proveedores });
    await waitFor(() => expect(result.current.tipo).toBe('error'));

    expect(result.current).toEqual({ tipo: 'error' });
  });

  it('al cambiar de cuenta no queda a la vista la anterior, ni por un instante', async () => {
    vi.mocked(getCuentasConectadas).mockResolvedValue([cuentaDe('cta-1', { necesita_reautorizacion: true }), cuentaDe('cta-2')]);
    const renders: { id: string | null; estado: ReturnType<typeof useCuentaDeImportacion> }[] = [];
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => {
        const estado = useCuentaDeImportacion(id);
        renders.push({ id, estado });
        return estado;
      },
      { wrapper: Proveedores, initialProps: { id: 'cta-1' as string | null } },
    );
    await waitFor(() => expect(result.current.tipo).toBe('listo'));

    renders.length = 0;
    rerender({ id: 'cta-2' });
    await waitFor(() => expect(result.current.tipo).toBe('listo'));

    const conLaAnterior = renders.filter(({ id, estado }) => id === 'cta-2' && estado.tipo === 'listo' && estado.cuenta?.id === 'cta-1');
    expect(conLaAnterior).toEqual([]);
    expect(renders[0]).toEqual({ id: 'cta-2', estado: { tipo: 'cargando' } });
    expect(result.current).toEqual({ tipo: 'listo', cuenta: cuentaDe('cta-2') });
  });

  it('la respuesta de una sesión anterior que llega tarde no se muestra', async () => {
    const respuestaDeA = diferida<CuentaConectada[]>();
    vi.mocked(getCuentasConectadas).mockReturnValue(respuestaDeA.promesa);
    const { result } = renderHook(() => useCuentaDeImportacion('cta-1'), { wrapper: Proveedores });
    await waitFor(() => expect(getCuentasConectadas).toHaveBeenCalledTimes(1));

    await entraOtraSesion();
    await act(async () => respuestaDeA.resolver([cuentaDe('cta-1', { necesita_reautorizacion: true })]));

    expect(result.current).toEqual({ tipo: 'cargando' });
  });

  it('un error de una sesión anterior que llega tarde tampoco se muestra', async () => {
    const falloDeA = diferida<CuentaConectada[]>();
    vi.mocked(getCuentasConectadas).mockReturnValue(falloDeA.promesa);
    const { result } = renderHook(() => useCuentaDeImportacion('cta-1'), { wrapper: Proveedores });
    await waitFor(() => expect(getCuentasConectadas).toHaveBeenCalledTimes(1));

    await entraOtraSesion();
    await act(async () => falloDeA.rechazar(new TypeError('Failed to fetch')));

    expect(result.current).toEqual({ tipo: 'cargando' });
  });
  it('la respuesta de la cuenta anterior que llega después de cambiar de cuenta no reemplaza a la nueva', async () => {
    const respuestaDeLaAnterior = diferida<CuentaConectada[]>();
    vi.mocked(getCuentasConectadas).mockReturnValueOnce(respuestaDeLaAnterior.promesa).mockResolvedValueOnce([cuentaDe('cta-2')]);
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useCuentaDeImportacion(id), {
      wrapper: Proveedores,
      initialProps: { id: 'cta-1' as string | null },
    });
    rerender({ id: 'cta-2' });
    await waitFor(() => expect(result.current).toEqual({ tipo: 'listo', cuenta: cuentaDe('cta-2') }));

    await act(async () => respuestaDeLaAnterior.resolver([cuentaDe('cta-1', { necesita_reautorizacion: true })]));

    expect(result.current).toEqual({ tipo: 'listo', cuenta: cuentaDe('cta-2') });
  });
});

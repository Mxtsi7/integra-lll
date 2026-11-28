// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPermisosPlan, type PermisosPlan } from '@ojoalgasto/shared';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { MENSAJE_ERROR_PLAN, usePermisosPlan } from './usePermisosPlan';

vi.mock('@ojoalgasto/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ojoalgasto/shared')>();
  return { ...real, getPermisosPlan: vi.fn() };
});

const PERMISOS_PREMIUM: PermisosPlan = {
  plan: 'premium',
  features: { asistente_financiero: true, recomendaciones_automaticas: true },
};

const PERMISOS_FREE: PermisosPlan = {
  plan: 'free',
  features: { asistente_financiero: false, recomendaciones_automaticas: false },
};

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

describe('usePermisosPlan (SE-02, S3-CH-16)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getPermisosPlan).mockReset();
  });

  afterEach(cleanup);

  it('mientras carga no concede Premium ni features por defecto', async () => {
    const defer = diferida<PermisosPlan>();
    vi.mocked(getPermisosPlan).mockReturnValue(defer.promesa);

    const { result } = renderHook(() => usePermisosPlan(), { wrapper });

    expect(result.current.estado.tipo).toBe('cargando');
    expect(result.current.esPremium).toBe(false);
    expect(result.current.plan).toBeNull();
    expect(result.current.tieneFeature('asistente_financiero')).toBe(false);
    expect(result.current.tieneFeature('recomendaciones_automaticas')).toBe(false);

    await act(async () => defer.resolver(PERMISOS_PREMIUM));
    expect(result.current.estado.tipo).toBe('listo');
  });

  it('si el servidor responde Free expone plan y features bloqueadas', async () => {
    vi.mocked(getPermisosPlan).mockResolvedValue(PERMISOS_FREE);

    const { result } = renderHook(() => usePermisosPlan(), { wrapper });
    await act(async () => {});

    expect(result.current.estado.tipo).toBe('listo');
    expect(result.current.esPremium).toBe(false);
    expect(result.current.plan).toBe('free');
    expect(result.current.nombrePlan).toBe('Plan Gratuito');
    expect(result.current.detallePlan).toBe('Alertas de cobro y de prueba gratis incluidas.');
    expect(result.current.tieneFeature('asistente_financiero')).toBe(false);
    expect(result.current.tieneFeature('recomendaciones_automaticas')).toBe(false);
  });

  it('si el servidor responde Premium expone plan activo y features permitidas', async () => {
    vi.mocked(getPermisosPlan).mockResolvedValue(PERMISOS_PREMIUM);

    const { result } = renderHook(() => usePermisosPlan(), { wrapper });
    await act(async () => {});

    expect(result.current.estado.tipo).toBe('listo');
    expect(result.current.esPremium).toBe(true);
    expect(result.current.plan).toBe('premium');
    expect(result.current.nombrePlan).toBe('Plan Premium');
    expect(result.current.detallePlan).toBe('Asistente financiero y recomendaciones avanzadas.');
    expect(result.current.tieneFeature('asistente_financiero')).toBe(true);
    expect(result.current.tieneFeature('recomendaciones_automaticas')).toBe(true);
  });

  it('si falla la consulta explica el rechazo y no concede Premium', async () => {
    vi.mocked(getPermisosPlan).mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const { result } = renderHook(() => usePermisosPlan(), { wrapper });
    await act(async () => {});

    expect(result.current.estado.tipo).toBe('error');
    if (result.current.estado.tipo === 'error') {
      expect(result.current.estado.mensaje).toBe(MENSAJE_ERROR_PLAN);
    }
    expect(result.current.esPremium).toBe(false);
    expect(result.current.plan).toBeNull();
    expect(result.current.tieneFeature('asistente_financiero')).toBe(false);

    // Reintentar vuelve a solicitar al servidor
    vi.mocked(getPermisosPlan).mockResolvedValueOnce(PERMISOS_PREMIUM);
    await act(async () => {
      result.current.reintentar();
    });

    expect(result.current.estado.tipo).toBe('listo');
    expect(result.current.esPremium).toBe(true);
    expect(result.current.tieneFeature('asistente_financiero')).toBe(true);
    expect(getPermisosPlan).toHaveBeenCalledTimes(2);
  });

  it('si la respuesta del servidor es corrupta o desconocida no autoriza por omisión', async () => {
    // Objeto no conforme al contrato
    vi.mocked(getPermisosPlan).mockResolvedValueOnce({ plan: 'invalido', features: null } as unknown as PermisosPlan);

    const { result } = renderHook(() => usePermisosPlan(), { wrapper });
    await act(async () => {});

    expect(result.current.estado.tipo).toBe('error');
    expect(result.current.esPremium).toBe(false);
    expect(result.current.tieneFeature('asistente_financiero')).toBe(false);
  });

  it('descarta la respuesta si la sesión cambia en vuelo', async () => {
    const defer = diferida<PermisosPlan>();
    vi.mocked(getPermisosPlan).mockReturnValue(defer.promesa);

    let cerrarSesionFn!: () => void;
    function ComponentePrueba() {
      const auth = useAuth();
      cerrarSesionFn = auth.cerrarSesion;
      return null;
    }

    const { result } = renderHook(
      () => {
        ComponentePrueba();
        return usePermisosPlan();
      },
      { wrapper },
    );

    // Cambia la sesión mientras la petición vuela
    act(() => {
      cerrarSesionFn();
    });

    // Se resuelve la promesa de la sesión previa
    await act(async () => {
      defer.resolver(PERMISOS_PREMIUM);
    });

    // La respuesta vieja no se asume como propia de la nueva sesión
    expect(result.current.estado.tipo).toBe('cargando');
    expect(result.current.esPremium).toBe(false);
  });
});

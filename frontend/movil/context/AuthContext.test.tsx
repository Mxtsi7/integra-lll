// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  configurarTokenStorage,
  configureAuthApi,
  configurarApi,
  guardarTokens,
  haySesionValida,
  logout,
  getUsuarioActual,
  type Usuario,
} from '@ojoalgasto/shared';
import { AuthProvider, useAuth, type Tokens } from './AuthContext';

const almacen: Record<string, string> = {};

function jwtValido(expSegundos: number = Math.floor(Date.now() / 1000) + 3600): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(JSON.stringify({ exp: expSegundos, user_id: 'usr-1', rol: 'titular' })),
    'firma',
  ].join('.');
}

const USUARIO_PRUEBA: Usuario = {
  id: 'usr-1',
  nombre: 'Usuario Prueba',
  correo: 'prueba@ojoalgasto.cl',
  rol: 'titular',
  organizacion_id: 'org-1',
  plan: 'gratuito',
};

describe('AuthContext móvil', () => {
  const fetchMock = vi.fn();
  const URL_BASE = 'https://api.staging.ojoalgasto.cl/api';

  beforeEach(() => {
    for (const k of Object.keys(almacen)) delete almacen[k];
    configurarTokenStorage({
      getItem: (k: string) => almacen[k] ?? null,
      setItem: (k: string, v: string) => {
        almacen[k] = v;
      },
      removeItem: (k: string) => {
        delete almacen[k];
      },
    });

    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    configurarApi({ urlBase: URL_BASE });
    configureAuthApi({ baseUrl: URL_BASE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    logout();
  });

  it('iniciarSesion con tokens válidos autentica y guarda en storage', async () => {
    const tokens: Tokens = {
      access_token: jwtValido(),
      refresh_token: 'refresh-token-valido',
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(USUARIO_PRUEBA), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');

    act(() => {
      result.current.iniciarSesion(tokens, USUARIO_PRUEBA);
    });

    expect(result.current.haySesion).toBe(true);
    expect(result.current.estado).toBe('autenticado');
    expect(result.current.usuario).toEqual(USUARIO_PRUEBA);
    expect(haySesionValida()).toBe(true);
    expect(almacen['access_token']).toBe(tokens.access_token);
    expect(almacen['refresh_token']).toBe(tokens.refresh_token);
  });

  it('iniciarSesion rechaza tokens inválidos y no transiciona a autenticado [P1]', () => {
    const tokensInvalidos: Tokens = {
      access_token: 'token-basura-no-jwt',
      refresh_token: 'refresh-xyz',
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(() => {
      act(() => {
        result.current.iniciarSesion(tokensInvalidos);
      });
    }).toThrow('Token inválido o expirado');

    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');
    expect(haySesionValida()).toBe(false);
    expect(almacen['access_token']).toBeUndefined();
  });

  it('cerrarSesion revoca en la URL configurada por EXPO_PUBLIC_API_URL y limpia storage [P1]', async () => {
    const tokens: Tokens = {
      access_token: jwtValido(),
      refresh_token: 'refresh-12345',
    };
    guardarTokens(tokens);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Sesión revocada' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider initialEstado="autenticado" initialUsuario={USUARIO_PRUEBA}>
        {children}
      </AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.haySesion).toBe(true);

    await act(async () => {
      await result.current.cerrarSesion();
    });

    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');
    expect(result.current.usuario).toBeNull();

    // Verificación de que fetch apuntó al servidor configurado y no a localhost
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/auth/logout/`);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ refresh_token: 'refresh-12345' });

    // Verificación de que se limpió el storage local compartido
    expect(haySesionValida()).toBe(false);
    expect(almacen['access_token']).toBeUndefined();
    expect(almacen['refresh_token']).toBeUndefined();
  });

  it('cerrarSesion limpia localmente incluso si la revocación en backend falla [P1]', async () => {
    const tokens: Tokens = {
      access_token: jwtValido(),
      refresh_token: 'refresh-fallo',
    };
    guardarTokens(tokens);

    fetchMock.mockRejectedValueOnce(new TypeError('NetworkError: Failed to fetch'));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider initialEstado="autenticado" initialUsuario={USUARIO_PRUEBA}>
        {children}
      </AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.cerrarSesion();
    });

    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');
    expect(haySesionValida()).toBe(false);
    expect(almacen['access_token']).toBeUndefined();
  });

  it('bootstrap inicial: sin sesión válida queda en anónimo', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Esperar al efecto de bootstrap inicial
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');
  });

  it('arnés de pruebas aislado permite inyectar estado autenticado sin bypass público', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider initialEstado="autenticado" initialUsuario={USUARIO_PRUEBA}>
        {children}
      </AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.haySesion).toBe(true);
    expect(result.current.estado).toBe('autenticado');
    expect(result.current.usuario).toEqual(USUARIO_PRUEBA);
  });

  describe('Carga de perfil autorizado (/usuarios/me/) y consistencia de sesión', () => {
    it('login de integrante con plan premium y organización real carga perfil autorizado [P2]', async () => {
      const tokens: Tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-integrante-1',
      };

      const USUARIO_INTEGRANTE: Usuario = {
        id: 'usr-int-99',
        nombre: 'Carlos Integrante',
        correo: 'carlos@empresa.com',
        rol: 'integrante',
        organizacion_id: 'org-empresa-real',
        plan: 'premium',
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(USUARIO_INTEGRANTE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        result.current.iniciarSesion(tokens);
      });

      expect(result.current.haySesion).toBe(true);
      expect(result.current.estado).toBe('autenticado');
      expect(result.current.estadoPerfil).toBe('cargado');
      expect(result.current.usuario).toEqual(USUARIO_INTEGRANTE);
      expect(result.current.usuario?.rol).toBe('integrante');
      expect(result.current.usuario?.plan).toBe('premium');
      expect(result.current.usuario?.organizacion_id).toBe('org-empresa-real');

      expect(fetchMock).toHaveBeenCalledWith(
        `${URL_BASE}/usuarios/me/`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${tokens.access_token}`,
          }),
        })
      );
    });

    it('login de titular carga correctamente rol titular y su organización [P2]', async () => {
      const tokens: Tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-titular-1',
      };

      const USUARIO_TITULAR: Usuario = {
        id: 'usr-tit-1',
        nombre: 'Ana Titular',
        correo: 'ana@hogar.com',
        rol: 'titular',
        organizacion_id: 'org-hogar-1',
        plan: 'familiar',
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(USUARIO_TITULAR), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        result.current.iniciarSesion(tokens);
      });

      expect(result.current.haySesion).toBe(true);
      expect(result.current.estado).toBe('autenticado');
      expect(result.current.usuario).toEqual(USUARIO_TITULAR);
      expect(result.current.usuario?.rol).toBe('titular');
      expect(result.current.usuario?.plan).toBe('familiar');
      expect(result.current.usuario?.organizacion_id).toBe('org-hogar-1');
    });

    it('fallo de red en /me mantiene sesión autenticada pero con usuario null y estado error [P2]', async () => {
      const tokens: Tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-fallo-me',
      };

      fetchMock.mockRejectedValueOnce(new TypeError('Error de conexión con el servidor'));

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        result.current.iniciarSesion(tokens);
      });

      // La sesión es válida por token JWT, pero el perfil no se inventa
      expect(result.current.haySesion).toBe(true);
      expect(result.current.estado).toBe('autenticado');
      expect(result.current.usuario).toBeNull();
      expect(result.current.estadoPerfil).toBe('error');
      expect(result.current.errorPerfil).toBe('Error de conexión con el servidor');
    });

    it('protección de sesión: respuesta tardía de /me de sesión previa no sobreescribe estado tras logout o login de otro usuario [P2]', async () => {
      const tokensA: Tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-A',
      };

      const tokensB: Tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-B',
      };

      const USUARIO_A: Usuario = {
        id: 'usr-a',
        nombre: 'Usuario A',
        correo: 'a@correo.com',
        rol: 'titular',
        organizacion_id: 'org-a',
        plan: 'gratuito',
      };

      const USUARIO_B: Usuario = {
        id: 'usr-b',
        nombre: 'Usuario B',
        correo: 'b@correo.com',
        rol: 'integrante',
        organizacion_id: 'org-b',
        plan: 'premium',
      };

      let resolverMeA: (resp: Response) => void;
      const promesaMeA = new Promise<Response>((resolve) => {
        resolverMeA = resolve;
      });

      // Primera llamada a fetch: /me para sesión A (queda pendiente)
      fetchMock.mockReturnValueOnce(promesaMeA);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Inicia sesión A
      act(() => {
        result.current.iniciarSesion(tokensA);
      });

      expect(result.current.haySesion).toBe(true);
      expect(result.current.estadoPerfil).toBe('cargando');
      expect(result.current.usuario).toBeNull();

      // Caso 1: Usuario A cierra sesión mientras /me sigue en vuelo
      // Mock de logout
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Sesión revocada' }), { status: 200 })
      );

      await act(async () => {
        await result.current.cerrarSesion();
      });

      expect(result.current.haySesion).toBe(false);
      expect(result.current.estado).toBe('anonimo');
      expect(result.current.usuario).toBeNull();

      // Ahora se resuelve la respuesta tardía de A
      await act(async () => {
        resolverMeA!(
          new Response(JSON.stringify(USUARIO_A), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      // La respuesta tardía no debió revivir la sesión ni asignar el usuario de A
      expect(result.current.haySesion).toBe(false);
      expect(result.current.estado).toBe('anonimo');
      expect(result.current.usuario).toBeNull();

      // Caso 2: Entra Usuario B y luego una petición vieja tardía intenta responder
      let resolverMeA2: (resp: Response) => void;
      const promesaMeA2 = new Promise<Response>((resolve) => {
        resolverMeA2 = resolve;
      });

      // Petición de A2
      fetchMock.mockReturnValueOnce(promesaMeA2);

      act(() => {
        result.current.iniciarSesion(tokensA);
      });

      // Antes de que resuelva A2, entra B
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(USUARIO_B), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await act(async () => {
        result.current.iniciarSesion(tokensB);
      });

      expect(result.current.usuario).toEqual(USUARIO_B);

      // Ahora resuelve la petición vieja de A2
      await act(async () => {
        resolverMeA2!(
          new Response(JSON.stringify(USUARIO_A), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      // El usuario sigue siendo B, no fue pisado por A
      expect(result.current.usuario).toEqual(USUARIO_B);
      expect(result.current.usuario?.rol).toBe('integrante');
      expect(result.current.usuario?.plan).toBe('premium');
    });

    it('interceptor 401: respuesta 401 en petición protegida cierra sesión y conmuta a anónimo', async () => {
      const tokens: Tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-401',
      };
      guardarTokens(tokens);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="autenticado" initialUsuario={USUARIO_PRUEBA}>
          {children}
        </AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.haySesion).toBe(true);

      // Simular que una petición protegida cualquiera recibe 401
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Token inválido o expirado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await act(async () => {
        try {
          await getUsuarioActual();
        } catch {
          // ErrorDeApi esperado
        }
      });

      expect(result.current.haySesion).toBe(false);
      expect(result.current.estado).toBe('anonimo');
      expect(result.current.usuario).toBeNull();
      expect(haySesionValida()).toBe(false);
      expect(almacen['access_token']).toBeUndefined();
    });
  });
});


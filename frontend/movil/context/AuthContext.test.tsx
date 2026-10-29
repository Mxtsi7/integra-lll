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
  obtenerAccessToken,
  logout,
  getUsuarioActual,
  type Usuario,
} from '@ojoalgasto/shared';
import * as SecureStore from 'expo-secure-store';
import {
  guardarTokensSeguros,
  limpiarSesionSegura,
  inicializarStorageSeguro,
  adaptadorStorageSincrono,
  CLAVES_SEGURAS,
} from '../src/services/storageSeguro';
import { AuthProvider, useAuth, type Tokens } from './AuthContext';
function jwtValido(expSegundos: number = Math.floor(Date.now() / 1000) + 3600): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(JSON.stringify({ exp: expSegundos, user_id: 'usr-1', rol: 'titular', iat: Math.floor(Date.now() / 1000) })),
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

  beforeEach(async () => {
    await limpiarSesionSegura();
    inicializarStorageSeguro();

    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    configurarApi({ urlBase: URL_BASE });
    configureAuthApi({ baseUrl: URL_BASE });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await limpiarSesionSegura();
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

    await act(async () => {
      await result.current.iniciarSesion(tokens, USUARIO_PRUEBA);
    });

    expect(result.current.haySesion).toBe(true);
    expect(result.current.estado).toBe('autenticado');
    expect(result.current.usuario).toEqual(USUARIO_PRUEBA);
    expect(haySesionValida()).toBe(true);
    expect(await SecureStore.getItemAsync('access_token')).toBe(tokens.access_token);
    expect(await SecureStore.getItemAsync('refresh_token')).toBe(tokens.refresh_token);
    expect(obtenerAccessToken()).toBe(tokens.access_token);
  });

  it('iniciarSesion rechaza tokens inválidos y no transiciona a autenticado [P1]', async () => {
    const tokensInvalidos: Tokens = {
      access_token: 'token-basura-no-jwt',
      refresh_token: 'refresh-xyz',
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.iniciarSesion(tokensInvalidos);
      })
    ).rejects.toThrow('Token inválido o expirado');

    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');
    expect(haySesionValida()).toBe(false);
    expect(await SecureStore.getItemAsync('access_token')).toBeNull();
    expect(obtenerAccessToken()).toBeNull();
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

    // Verificación de que se limpió el storage local compartido y SecureStore
    expect(haySesionValida()).toBe(false);
    expect(await SecureStore.getItemAsync('access_token')).toBeNull();
    expect(await SecureStore.getItemAsync('refresh_token')).toBeNull();
    expect(obtenerAccessToken()).toBeNull();
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
    expect(await SecureStore.getItemAsync('access_token')).toBeNull();
    expect(obtenerAccessToken()).toBeNull();
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

  it('reinicio: bootstrap con tokens válidos en SecureStore hidrata y recupera sesión [SE-08]', async () => {
    const tokensGuardados = {
      access_token: jwtValido(),
      refresh_token: 'refresh-persistente-secure-store',
    };
    await SecureStore.setItemAsync('access_token', tokensGuardados.access_token);
    await SecureStore.setItemAsync('refresh_token', tokensGuardados.refresh_token);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(USUARIO_PRUEBA), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Esperar a la hidratación asíncrona de SecureStore y carga del perfil
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.haySesion).toBe(true);
    expect(result.current.estado).toBe('autenticado');
    expect(result.current.usuario).toEqual(USUARIO_PRUEBA);
    expect(result.current.estadoPerfil).toBe('cargado');
    expect(haySesionValida()).toBe(true);
    expect(obtenerAccessToken()).toBe(tokensGuardados.access_token);
  });

  it('bootstrap con token expirado en SecureStore purga SecureStore y conmuta a anónimo [SE-08]', async () => {
    const tokenExpirado = jwtValido(Math.floor(Date.now() / 1000) - 3600);
    await SecureStore.setItemAsync('access_token', tokenExpirado);
    await SecureStore.setItemAsync('refresh_token', 'refresh-expirado');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');
    expect(await SecureStore.getItemAsync('access_token')).toBeNull();
    expect(obtenerAccessToken()).toBeNull();
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
        await result.current.iniciarSesion(tokens);
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
        await result.current.iniciarSesion(tokens);
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
        await result.current.iniciarSesion(tokens);
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
      await act(async () => {
        await result.current.iniciarSesion(tokensA);
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

      await act(async () => {
        await result.current.iniciarSesion(tokensA);
      });

      // Antes de que resuelva A2, entra B
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(USUARIO_B), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await act(async () => {
        await result.current.iniciarSesion(tokensB);
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
      expect(obtenerAccessToken()).toBeNull();
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN)).toBeNull();
    });
  });

  describe('Regresiones de Persistencia y Orden de Mutaciones (Revisión SE-08 / SE-10)', () => {
    it('iniciarSesion espera la persistencia antes de confirmar autenticado (escritura lenta) [P2]', async () => {
      let resolverEscritura: () => void;
      const promesaEscritura = new Promise<void>((r) => {
        resolverEscritura = r;
      });

      // Simular backend con escritura lenta en SecureStore
      const setItemSpy = vi.spyOn(SecureStore, 'setItemAsync').mockImplementation(async () => {
        await promesaEscritura;
      });

      const tokens: Tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-lento',
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Disparar login sin esperar la resolución de la escritura
      let loginTerminado = false;
      const promesaLogin = act(async () => {
        await result.current.iniciarSesion(tokens, USUARIO_PRUEBA);
        loginTerminado = true;
      });

      // Antes de que resuelva la escritura persistente:
      // El estado NO debe ser 'autenticado' prematuramente
      expect(loginTerminado).toBe(false);
      expect(result.current.estado).toBe('anonimo');
      expect(result.current.haySesion).toBe(false);

      // Ahora resolvemos la escritura en hardware
      resolverEscritura!();
      await promesaLogin;

      // Tras la confirmación de la persistencia:
      expect(loginTerminado).toBe(true);
      expect(result.current.estado).toBe('autenticado');
      expect(result.current.haySesion).toBe(true);

      setItemSpy.mockRestore();
    });

    it('rechazo de persistencia en access, refresh o desfase aborta login con rollback sin promesas sin manejar [P2]', async () => {
      const setItemSpy = vi
        .spyOn(SecureStore, 'setItemAsync')
        .mockRejectedValue(new Error('Keystore hardware error'));

      try {
        const tokens: Tokens = {
          access_token: jwtValido(),
          refresh_token: 'refresh-fallido',
        };

        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
        );

        const { result } = renderHook(() => useAuth(), { wrapper });

        let errorCapturado: any;
        try {
          await act(async () => {
            await result.current.iniciarSesion(tokens, USUARIO_PRUEBA);
          });
        } catch (e) {
          errorCapturado = e;
        }
        expect(errorCapturado?.message).toMatch('Fallo al persistir tokens en almacenamiento seguro');

        // Memoria y estado de contexto deben quedar totalmente limpios (rollback)
        expect(result.current.haySesion).toBe(false);
        expect(result.current.estado).toBe('anonimo');
        expect(result.current.usuario).toBeNull();
        expect(haySesionValida()).toBe(false);
        expect(obtenerAccessToken()).toBeNull();
      } finally {
        setItemSpy.mockRestore();
      }
    });

    it('fallo de borrado persistente en cerrarSesion propaga error pero garantiza navegación pública en RAM [P1]', async () => {
      const deleteItemSpy = vi
        .spyOn(SecureStore, 'deleteItemAsync')
        .mockRejectedValue(new Error('Hardware delete error'));

      try {
        const tokens: Tokens = {
          access_token: jwtValido(),
          refresh_token: 'refresh-error-delete',
        };

        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <AuthProvider initialEstado="autenticado" initialUsuario={USUARIO_PRUEBA}>
            {children}
          </AuthProvider>
        );

        const { result } = renderHook(() => useAuth(), { wrapper });

        expect(result.current.haySesion).toBe(true);

        let errorCerrar: any;
        try {
          await act(async () => {
            await result.current.cerrarSesion();
          });
        } catch (e) {
          errorCerrar = e;
        }
        await act(async () => {});
        expect(errorCerrar?.message).toMatch('Fallo al limpiar sesión en almacenamiento seguro');

        // A pesar del fallo en hardware, la memoria síncrona se limpió inmediatamente (navegación pública)
        expect(result.current.haySesion).toBe(false);
        expect(result.current.estado).toBe('anonimo');
        expect(result.current.usuario).toBeNull();
        expect(haySesionValida()).toBe(false);
        expect(obtenerAccessToken()).toBeNull();
      } finally {
        deleteItemSpy.mockRestore();
      }
    });
  });
});


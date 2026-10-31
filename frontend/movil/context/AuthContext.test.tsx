// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  configureAuthApi,
  configurarApi,
  guardarTokens,
  haySesionValida,
  obtenerAccessToken,
  logout,
  getUsuarioActual,
  obtenerRefreshToken,
  type Usuario,
} from '@ojoalgasto/shared';
import * as SecureStore from 'expo-secure-store';
import {
  guardarTokensSeguros,
  inicializarStorageSeguro,
  adaptadorStorageSincrono,
  CLAVES_SEGURAS,
  hidratarSesionSegura,
  __reiniciarEstadoParaPruebas,
} from '../src/services/storageSeguro';
import { configurarClienteHttp } from '../src/services/clienteHttp';
import { AuthProvider, useAuth, type Tokens } from './AuthContext';
import {
  __fallarBorrados,
  __limpiar as limpiarSecureStore,
} from '../test/expo-secure-store-shim';

function jwtValido(expSegundos: number = Math.floor(Date.now() / 1000) + 3600): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(JSON.stringify({ exp: expSegundos, user_id: 'usr-1', rol: 'titular', iat: Math.floor(Date.now() / 1000) })),
    'firma',
  ].join('.');
}

/** JWT de una sesión concreta (mismo `sid` = misma sesión tras una rotación). */
function jwtConSesion(
  sid: string,
  jti: string,
  expSegundos: number = Math.floor(Date.now() / 1000) + 3600
): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(
      JSON.stringify({
        exp: expSegundos,
        iat: Math.floor(Date.now() / 1000),
        user_id: 'usr-1',
        organizacion_id: 'org-1',
        sid,
        jti,
        rol: 'titular',
      })
    ),
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
    __reiniciarEstadoParaPruebas();
    limpiarSecureStore();
    inicializarStorageSeguro();

    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    configurarApi({ urlBase: URL_BASE });
    configureAuthApi({ baseUrl: URL_BASE });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    __fallarBorrados(false);
    logout();
    __reiniciarEstadoParaPruebas();
    limpiarSecureStore();
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
    expect(opciones.headers['Authorization']).toBe(`Bearer ${tokens.access_token}`);
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

  it('un cierre con borrado seguro rechazado se vuelve observable y bloquea hasta reintentar [P1]', async () => {
    await guardarTokensSeguros({
      access_token: jwtValido(),
      refresh_token: 'refresh-borrado',
    });

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

    __fallarBorrados();
    await act(async () => {
      await result.current.cerrarSesion();
    });

    // La UI queda fuera de las rutas privadas y expone el fallo durable.
    expect(result.current.haySesion).toBe(false);
    expect(result.current.estado).toBe('anonimo');
    expect(result.current.errorCierre).toMatch(/no se pudo confirmar/i);

    // Un reintento con el keystore aún roto mantiene el aviso.
    let confirmado = true;
    await act(async () => {
      confirmado = await result.current.reintentarCierre();
    });
    expect(confirmado).toBe(false);
    expect(result.current.errorCierre).not.toBeNull();

    // Recuperado el keystore, el reintento confirma y limpia el aviso.
    __fallarBorrados(false);
    await act(async () => {
      confirmado = await result.current.reintentarCierre();
    });
    expect(confirmado).toBe(true);
    expect(result.current.errorCierre).toBeNull();

    // Un arranque posterior no recupera la sesión cerrada.
    __reiniciarEstadoParaPruebas();
    inicializarStorageSeguro();
    await hidratarSesionSegura();
    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
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

      // Simular que una petición protegida cualquiera recibe 401 y que el
      // refresh tampoco sirve: el cliente debe cerrar la sesión.
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Token inválido o expirado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Refresh inválido' }), {
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

  describe('Carga de perfil: refresh temporal y rotación de la misma sesión (Revisión 132)', () => {
    it('un 503 temporal al renovar /me conserva los tokens y deja el perfil recuperable [P2]', async () => {
      const tokens: Tokens = {
        access_token: jwtConSesion('sesion-a', 'a-1'),
        refresh_token: 'refresh-a-1',
      };

      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/usuarios/me/')) {
          return new Response(JSON.stringify({ detail: 'Token vencido' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/auth/refresh/')) {
          return new Response(JSON.stringify({ detail: 'Redis caído' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`URL inesperada en la prueba: ${url}`);
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.iniciarSesion(tokens);
      });

      // Dos intentos de refresh con 503 y su espera de 200 ms.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 700));
      });

      // La sesión sigue viva y el perfil queda en error recuperable, no se borra.
      expect(result.current.haySesion).toBe(true);
      expect(result.current.estado).toBe('autenticado');
      expect(result.current.usuario).toBeNull();
      expect(result.current.estadoPerfil).toBe('error');
      expect(result.current.errorPerfil).toBe('Token vencido');
      expect(obtenerAccessToken()).toBe(tokens.access_token);
      expect(obtenerRefreshToken()).toBe(tokens.refresh_token);
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN)).toBe(
        tokens.access_token
      );
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN)).toBe(
        tokens.refresh_token
      );

      // Cuando vuelve el backend, el reintento del perfil no exige otro login.
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(USUARIO_PRUEBA), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await act(async () => {
        await result.current.recargarPerfil();
      });

      expect(result.current.estadoPerfil).toBe('cargado');
      expect(result.current.usuario).toEqual(USUARIO_PRUEBA);
      expect(obtenerAccessToken()).toBe(tokens.access_token);
      expect(obtenerRefreshToken()).toBe(tokens.refresh_token);
    });

    it('un 401 tardío de A1 no borra A2 y recarga el perfil con la rotación vigente [P2]', async () => {
      const A1 = jwtConSesion('sesion-a', 'a-1');
      const A2 = jwtConSesion('sesion-a', 'a-2');
      const tokensA1: Tokens = { access_token: A1, refresh_token: 'refresh-a-1' };
      const tokensA2: Tokens = { access_token: A2, refresh_token: 'refresh-a-2' };

      let resolverPerfilA1: (respuesta: Response) => void = () => {};
      const perfilA1Pendiente = new Promise<Response>((resolver) => {
        resolverPerfilA1 = resolver;
      });
      fetchMock.mockReturnValueOnce(perfilA1Pendiente);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.iniciarSesion(tokensA1);
      });
      expect(result.current.estadoPerfil).toBe('cargando');

      // Mientras el perfil de A1 viaja, una rotación válida guarda A2/R2.
      await act(async () => {
        await guardarTokensSeguros(tokensA2);
      });
      expect(obtenerAccessToken()).toBe(A2);
      expect(obtenerRefreshToken()).toBe(tokensA2.refresh_token);

      // El perfil viejo responde 401; el reintento con A2 sí trae el usuario.
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(USUARIO_PRUEBA), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await act(async () => {
        resolverPerfilA1(
          new Response(JSON.stringify({ detail: 'Token vencido' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        );
        await new Promise((r) => setTimeout(r, 20));
      });

      expect(result.current.haySesion).toBe(true);
      expect(result.current.estado).toBe('autenticado');
      expect(result.current.estadoPerfil).toBe('cargado');
      expect(result.current.usuario).toEqual(USUARIO_PRUEBA);
      expect(obtenerAccessToken()).toBe(A2);
      expect(obtenerRefreshToken()).toBe(tokensA2.refresh_token);
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN)).toBe(A2);
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN)).toBe(
        tokensA2.refresh_token
      );

      const autorizaciones = fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith('/usuarios/me/'))
        .map(([, opciones]) => opciones.headers.Authorization);
      expect(autorizaciones).toEqual([`Bearer ${A1}`, `Bearer ${A2}`]);
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

    it('fallo de borrado persistente en cerrarSesion se expone como cierre pendiente sin lanzar [P1]', async () => {
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
        expect(errorCerrar).toBeUndefined();
        expect(result.current.errorCierre).toMatch(/no se pudo confirmar/i);

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

    it('logout A demorado no borra la sesión B posterior ni tras resolución 200 ni con fallo [P1 Hallazgo 1]', async () => {
      // 1. Iniciar sesión A
      const tokensA: Tokens = {
        access_token: jwtValido(Math.floor(Date.now() / 1000) + 1800),
        refresh_token: 'refresh-sesion-A',
      };
      const usuarioA: Usuario = { ...USUARIO_PRUEBA, id: 'usr-A', nombre: 'Usuario A' };

      const tokensB: Tokens = {
        access_token: jwtValido(Math.floor(Date.now() / 1000) + 3600),
        refresh_token: 'refresh-sesion-B',
      };
      const usuarioB: Usuario = { ...USUARIO_PRUEBA, id: 'usr-B', nombre: 'Usuario B' };

      let resolverLogoutA: (res: any) => void = () => {};
      const promesaLogoutA = new Promise((resolve) => {
        resolverLogoutA = resolve;
      });

      // Mockear fetch para pausar la respuesta a /auth/logout/
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/logout/')) {
          await promesaLogoutA;
          return { ok: true, status: 200, json: async () => ({}) };
        }
        if (url.includes('/usuarios/me/')) {
          return { ok: true, status: 200, json: async () => usuarioB };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider initialEstado="autenticado" initialUsuario={usuarioA}>
          {children}
        </AuthProvider>
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Guardar tokens de A en storage para simular estado activo
      await guardarTokensSeguros(tokensA);
      expect(result.current.haySesion).toBe(true);

      // 2. Ejecutar cerrarSesion() de A (UI debe quedar en anónimo inmediatamente)
      let promesaCierre: Promise<void> | undefined;
      await act(async () => {
        promesaCierre = result.current.cerrarSesion();
      });

      expect(result.current.estado).toBe('anonimo');
      expect(result.current.usuario).toBeNull();
      expect(result.current.haySesion).toBe(false);

      // 3. Durante la espera de red del logout A, completar iniciarSesion(B)
      await act(async () => {
        await result.current.iniciarSesion(tokensB, usuarioB);
      });

      expect(result.current.estado).toBe('autenticado');
      expect(result.current.usuario).toEqual(usuarioB);
      expect(obtenerAccessToken()).toBe(tokensB.access_token);

      // 4. Resolver el logout de A (200 OK del Gateway)
      resolverLogoutA(true);
      await act(async () => {
        await promesaCierre;
        await new Promise((r) => setTimeout(r, 20));
      });

      // 5. Invariante: B debe seguir intacta en estado, RAM y SecureStore
      expect(result.current.estado).toBe('autenticado');
      expect(result.current.usuario).toEqual(usuarioB);
      expect(obtenerAccessToken()).toBe(tokensB.access_token);
      expect(await SecureStore.getItemAsync('access_token')).toBe(tokensB.access_token);

      // Reinicio simulado: B sigue persistida
      __reiniciarEstadoParaPruebas();
      inicializarStorageSeguro();
      const resHidratacion = await hidratarSesionSegura();
      expect(resHidratacion.hayTokens).toBe(true);
      expect(obtenerAccessToken()).toBe(tokensB.access_token);
    });

    it('intercalado: fallo de persistencia de login A no cancela ni invalida login B posterior [P1 Hallazgo 2]', async () => {
      const tokensA: Tokens = {
        access_token: jwtValido(Math.floor(Date.now() / 1000) + 1800),
        refresh_token: 'refresh-login-A',
      };
      const tokensB: Tokens = {
        access_token: jwtValido(Math.floor(Date.now() / 1000) + 3600),
        refresh_token: 'refresh-login-B',
      };
      const usuarioB: Usuario = { ...USUARIO_PRUEBA, id: 'usr-B', nombre: 'Usuario B' };

      let rechazarEscrituraA: (err: any) => void = () => {};
      const promesaBloqueoA = new Promise<void>((_, reject) => {
        rechazarEscrituraA = reject;
      });

      const setItemSpy = vi.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (key, val) => {
        if (val === tokensA.access_token) {
          await promesaBloqueoA;
        }
      });

      try {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <AuthProvider>{children}</AuthProvider>
        );

        const { result } = renderHook(() => useAuth(), { wrapper });

        // 1. Iniciar login A y B concurrentemente dentro de act() para evitar act() solapados
        let errorA: any;
        let bCompleto = false;
        await act(async () => {
          const pA = result.current.iniciarSesion(tokensA).catch((e) => {
            errorA = e;
          });

          await new Promise((r) => setTimeout(r, 10));

          const pB = result.current.iniciarSesion(tokensB, usuarioB).then(() => {
            bCompleto = true;
          });

          // Desbloquear / rechazar A para permitir que la cola avance
          rechazarEscrituraA(new Error('Fallo de hardware en token A'));

          await pA;
          await pB;
        });

        expect(errorA).toBeDefined();
        expect(bCompleto).toBe(true);

        // 5. El fallo de A no debe resetear el contexto a anónimo
        expect(result.current.estado).toBe('autenticado');
        expect(result.current.usuario).toEqual(usuarioB);
        expect(haySesionValida()).toBe(true);
      } finally {
        setItemSpy.mockRestore();
      }
    });

    it('iniciarSesion acepta token recién emitido con el reloj del teléfono adelantado 40 minutos [P2 Hallazgo 4]', async () => {
      const ahoraServidor = Math.floor(Date.now() / 1000);
      const desfaseMs = 40 * 60 * 1000;

      const realNow = Date.now.bind(Date);
      const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + desfaseMs);

      try {
        const base64url = (t: string) =>
          btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const tokenConRelojDesfasado: Tokens = {
          access_token: [
            base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
            base64url(
              JSON.stringify({
                iat: ahoraServidor,
                exp: ahoraServidor + 30 * 60,
                user_id: 'usr-1',
                rol: 'titular',
              })
            ),
            'firma',
          ].join('.'),
          refresh_token: 'refresh-desfase',
        };

        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <AuthProvider initialEstado="anonimo">{children}</AuthProvider>
        );

        const { result } = renderHook(() => useAuth(), { wrapper });

        // Token recién emitido debe aceptarse a pesar de los 40 min de adelanto en el reloj
        await act(async () => {
          await result.current.iniciarSesion(tokenConRelojDesfasado, USUARIO_PRUEBA);
        });

        expect(result.current.haySesion).toBe(true);
        expect(result.current.estado).toBe('autenticado');

        // Token realmente expirado (exp <= iat)
        const tokenExpirado: Tokens = {
          access_token: [
            base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
            base64url(
              JSON.stringify({
                iat: ahoraServidor,
                exp: ahoraServidor - 60,
                user_id: 'usr-1',
                rol: 'titular',
              })
            ),
            'firma',
          ].join('.'),
          refresh_token: 'refresh-expirado',
        };

        await expect(
          act(async () => {
            await result.current.iniciarSesion(tokenExpirado);
          })
        ).rejects.toThrow('Token inválido o expirado');
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('cerrarSesion con sesión de más de 30 min (access token vencido) NO envía header Authorization para evitar 401 en DRF, pero sí envía refresh_token [P2]', async () => {
      const ahoraServidor = Math.floor(Date.now() / 1000);
      const base64url = (t: string) =>
        btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // Token emitido con 30 min de vigencia
      const tokens: Tokens = {
        access_token: [
          base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
          base64url(
            JSON.stringify({
              iat: ahoraServidor,
              exp: ahoraServidor + 30 * 60,
              user_id: 'usr-1',
              rol: 'titular',
            })
          ),
          'firma',
        ].join('.'),
        refresh_token: 'refresh-vencido-123',
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

      // Avanzamos el reloj 35 minutos (más allá de los 30 min de vigencia del token de acceso)
      const realNow = Date.now.bind(Date);
      const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 35 * 60 * 1000);

      try {
        await act(async () => {
          await result.current.cerrarSesion();
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, opciones] = fetchMock.mock.calls[0];
        expect(url).toBe(`${URL_BASE}/auth/logout/`);
        expect(opciones.method).toBe('POST');
        // El header Authorization DEBE omitirse para no causar 401 en DRF
        expect(opciones.headers['Authorization']).toBeUndefined();
        // El refresh_token en el cuerpo SÍ debe enviarse
        expect(JSON.parse(opciones.body)).toEqual({ refresh_token: 'refresh-vencido-123' });
      } finally {
        dateSpy.mockRestore();
      }
    });
  });
});

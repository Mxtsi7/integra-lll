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
});

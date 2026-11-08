// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as SecureStore from 'expo-secure-store';
import {
  obtenerAccessToken,
  obtenerRefreshToken,
  type Usuario,
} from '@ojoalgasto/shared';
import { App } from '../../../App';
import {
  limpiarSesionSegura,
  inicializarStorageSeguro,
  CLAVES_SEGURAS,
} from '../../services/storageSeguro';
import { MENSAJE_ERROR_RED } from '../../services/clienteHttp';

function jwtValido(expSegundos: number = Math.floor(Date.now() / 1000) + 3600): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(
      JSON.stringify({
        exp: expSegundos,
        user_id: 'usr-10',
        rol: 'titular',
        iat: Math.floor(Date.now() / 1000),
      })
    ),
    'firma-segura',
  ].join('.');
}

const USUARIO_BACKEND: Usuario = {
  id: 'usr-10',
  nombre: 'Sebastian Mena',
  correo: 'sebastian.mena@ojoalgasto.cl',
  rol: 'titular',
  organizacion_id: 'org-seba-10',
  plan: 'premium',
};

describe('Conectar Login móvil con Auth (SE-10)', () => {
  beforeEach(async () => {
    await limpiarSesionSegura();
    inicializarStorageSeguro();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Criterio 1: Distinción entre credenciales incorrectas y error de conexión', () => {
    it('credenciales incorrectas (401) muestra mensaje específico de usuario/clave inválidos', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/login/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                detail: 'No active account found with the given credentials',
              }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        return Promise.reject(new Error(`URL no manejada: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'err@ojoalgasto.cl' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'clave-incorrecta' },
      });

      fireEvent.click(screen.getByTestId('login-submit'));

      // Verificar mensaje de credenciales
      expect(await screen.findByTestId('login-error')).toBeTruthy();
      expect(screen.getByText('Usuario o contraseña inválidos')).toBeTruthy();
      // NO debe mostrar el mensaje de error de red
      expect(screen.queryByText(MENSAJE_ERROR_RED)).toBeNull();

      // No debe navegar a home
      expect(screen.queryByTestId('screen-home')).toBeNull();

      // No debe haber guardado tokens en SecureStore
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN)).toBeNull();
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN)).toBeNull();
      expect(obtenerAccessToken()).toBeNull();
    });

    it('error de conexión física (Network request failed) muestra mensaje específico de red y conexión', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError('Network request failed'));
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'offline@ojoalgasto.cl' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'clave123' },
      });

      fireEvent.click(screen.getByTestId('login-submit'));

      // Verificar mensaje de error de red adaptado
      expect(await screen.findByTestId('login-error')).toBeTruthy();
      expect(screen.getByText(MENSAJE_ERROR_RED)).toBeTruthy();
      // NO debe mostrar el mensaje de credenciales inválidas
      expect(screen.queryByText('Usuario o contraseña inválidos')).toBeNull();

      // No debe navegar a home
      expect(screen.queryByTestId('screen-home')).toBeNull();

      // No debe haber guardado tokens
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN)).toBeNull();
      expect(await SecureStore.getItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN)).toBeNull();
    });

    it('los mensajes de credenciales y conexión son mutuamente excluyentes y claramente distintos', () => {
      const mensajeCredenciales = 'Usuario o contraseña inválidos';
      const mensajeConexion = MENSAJE_ERROR_RED;

      expect(mensajeCredenciales).not.toBe(mensajeConexion);
      expect(mensajeConexion.toLowerCase()).toContain('conexión');
      expect(mensajeCredenciales.toLowerCase()).toContain('contraseña');
    });
  });

  describe('Criterio 2: Persistencia de ambos tokens y recuperación del usuario', () => {
    it('traduce correo a email en payload HTTP hacia /auth/login/', async () => {
      let payloadEnviado: any = null;

      const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
        if (url.includes('/auth/login/')) {
          payloadEnviado = JSON.parse(init.body);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: jwtValido(),
                refresh_token: 'refresh-token-se-10',
                usuario: { id: 10, nombre: 'Sebastian', correo: 'seba@test.cl' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        if (url.includes('/usuarios/me/')) {
          return Promise.resolve(
            new Response(JSON.stringify(USUARIO_BACKEND), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`URL no manejada: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: '  seba@test.cl  ' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'passwordSegura10' },
      });

      fireEvent.click(screen.getByTestId('login-submit'));

      await waitFor(() => {
        expect(payloadEnviado).not.toBeNull();
      });

      // Validar traducción por shared: correo -> email
      expect(payloadEnviado).toEqual({
        email: 'seba@test.cl',
        password: 'passwordSegura10',
      });
    });

    it('persiste ambos tokens (access y refresh) en SecureStore y memoria al iniciar sesión', async () => {
      const ACCESS_TOKEN_ESPERADO = jwtValido();
      const REFRESH_TOKEN_ESPERADO = 'refresh-secret-persisted-10';

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/login/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: ACCESS_TOKEN_ESPERADO,
                refresh_token: REFRESH_TOKEN_ESPERADO,
                usuario: { id: 10, nombre: 'Sebastian', correo: 'seba@test.cl' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        if (url.includes('/usuarios/me/')) {
          return Promise.resolve(
            new Response(JSON.stringify(USUARIO_BACKEND), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`URL no manejada: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'seba@test.cl' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'mi-clave' },
      });

      fireEvent.click(screen.getByTestId('login-submit'));

      // Esperar a que navegue a Home
      expect(await screen.findByTestId('screen-home')).toBeTruthy();

      // 1. Verificación en persistencia segura nativa (SecureStore)
      expect(
        await SecureStore.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN)
      ).toBe(ACCESS_TOKEN_ESPERADO);
      expect(
        await SecureStore.getItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN)
      ).toBe(REFRESH_TOKEN_ESPERADO);

      // 2. Verificación en caché síncrona en RAM (@ojoalgasto/shared)
      expect(obtenerAccessToken()).toBe(ACCESS_TOKEN_ESPERADO);
      expect(obtenerRefreshToken()).toBe(REFRESH_TOKEN_ESPERADO);
    });

    it('recupera el usuario autorizado desde /usuarios/me/ y navega a rutas privadas', async () => {
      let peticionMeHeaders: any = null;

      const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
        if (url.includes('/auth/login/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: jwtValido(),
                refresh_token: 'refresh-abc',
                usuario: { id: 10, nombre: 'Sebastian', correo: 'seba@test.cl' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        if (url.includes('/usuarios/me/')) {
          peticionMeHeaders = new Headers(init.headers);
          return Promise.resolve(
            new Response(JSON.stringify(USUARIO_BACKEND), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`URL no manejada: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'seba@test.cl' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'password10' },
      });

      fireEvent.click(screen.getByTestId('login-submit'));

      // Pantalla de Home montada (navegación reactiva)
      expect(await screen.findByTestId('screen-home')).toBeTruthy();
      expect(screen.queryByTestId('screen-login')).toBeNull();

      // Usuario recuperado y renderizado
      expect(
        await screen.findByText(new RegExp(`Usuario: ${USUARIO_BACKEND.nombre}`))
      ).toBeTruthy();

      // Petición /usuarios/me/ incluyó el token de acceso en Authorization Bearer
      expect(peticionMeHeaders).not.toBeNull();
      expect(peticionMeHeaders?.get('Authorization')).toMatch(/^Bearer /);
    });

    it('formulario permanece bloqueado y en estado de carga mientras la persistencia está en progreso [P2]', async () => {
      let resolverPersistencia: () => void;
      const promesaPersistencia = new Promise<void>((r) => {
        resolverPersistencia = r;
      });

      const setItemSpy = vi.spyOn(SecureStore, 'setItemAsync').mockImplementation(async () => {
        await promesaPersistencia;
      });

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/login/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: jwtValido(),
                refresh_token: 'refresh-bloqueo',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        if (url.includes('/usuarios/me/')) {
          return Promise.resolve(
            new Response(JSON.stringify(USUARIO_BACKEND), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`URL no manejada: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'bloqueo@test.cl' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(screen.getByTestId('login-submit'));

      // Mientras la persistencia está en progreso, el botón debe estar deshabilitado
      await waitFor(() => {
        expect(screen.getByTestId('login-submit').getAttribute('aria-disabled')).toBe('true');
      });

      // Todavía no debe navegar a home
      expect(screen.queryByTestId('screen-home')).toBeNull();

      // Resolver persistencia
      resolverPersistencia!();

      // Ahora sí conmuta a Home
      expect(await screen.findByTestId('screen-home')).toBeTruthy();

      setItemSpy.mockRestore();
    });

    it('fallo al persistir tokens en almacenamiento seguro muestra error y desbloquea el formulario [P2]', async () => {
      const setItemSpy = vi
        .spyOn(SecureStore, 'setItemAsync')
        .mockRejectedValue(new Error('Almacenamiento protegido no disponible'));

      try {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
          if (url.includes('/auth/login/')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  access_token: jwtValido(),
                  refresh_token: 'refresh-fallido',
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              )
            );
          }
          return Promise.reject(new Error(`URL no manejada: ${url}`));
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<App initialEstado="anonimo" />);

        fireEvent.change(screen.getByTestId('input-correo'), {
          target: { value: 'fallo@test.cl' },
        });
        fireEvent.change(screen.getByTestId('input-password'), {
          target: { value: 'password123' },
        });

        fireEvent.click(screen.getByTestId('login-submit'));

        // Debe mostrar el error del storage
        expect(await screen.findByTestId('login-error')).toBeTruthy();
        expect(
          screen.getByText(/Fallo al persistir tokens en almacenamiento seguro/)
        ).toBeTruthy();

        // Debe permanecer en login
        expect(screen.queryByTestId('screen-home')).toBeNull();

        // Botón debe estar desbloqueado para reintentar
        expect(screen.getByTestId('login-submit').getAttribute('aria-disabled')).not.toBe('true');
      } finally {
        setItemSpy.mockRestore();
      }
    });
  });
});

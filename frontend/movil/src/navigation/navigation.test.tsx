// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  type Usuario,
  configurarTokenStorage,
  guardarTokens,
  obtenerAccessToken,
  pedir,
} from '@ojoalgasto/shared';
import { App } from '../../App';

const almacen: Record<string, string> = {};

function jwtValido(expSegundos: number = Math.floor(Date.now() / 1000) + 3600): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(JSON.stringify({ exp: expSegundos, user_id: 'usr-42', rol: 'titular' })),
    'firma',
  ].join('.');
}

const USUARIO: Usuario = {
  id: 'usr-42',
  nombre: 'Sebastian Mena',
  correo: 'sebastian@ojoalgasto.cl',
  rol: 'titular',
  organizacion_id: 'org-test',
  plan: 'gratuito',
};

const MOCK_SUSCRIPCIONES_API = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: '1',
      nombre: 'Netflix',
      monto: '9990.00',
      moneda: 'CLP',
      frecuencia: 'mensual',
      fecha_proximo_cobro: '2026-10-05',
      categoria: 'streaming',
      estado: 'activo',
      horas_uso_mes: '18.00',
    },
  ],
};

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

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/suscripciones/')) {
        const idMatch = url.match(/\/suscripciones\/([^/?]+)\/?(\?.*)?$/);
        if (idMatch && idMatch[1] && idMatch[1] !== '') {
          const item =
            MOCK_SUSCRIPCIONES_API.results.find((s) => s.id === idMatch[1]) ??
            MOCK_SUSCRIPCIONES_API.results[0];
          return new Response(JSON.stringify(item), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(MOCK_SUSCRIPCIONES_API), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ detail: 'Ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Navegación Móvil (SE-06)', () => {
  describe('Flujo público de acceso y Login funcional', () => {
    it('sin sesión arranca en Login y bloquea acceso a pestañas privadas', async () => {
      render(<App initialEstado="anonimo" />);

      expect(await screen.findByTestId('screen-login')).toBeTruthy();
      expect(screen.getByText('Bienvenido de nuevo')).toBeTruthy();
      expect(screen.getByTestId('input-correo')).toBeTruthy();
      expect(screen.getByTestId('input-password')).toBeTruthy();
      expect(screen.getByTestId('login-submit')).toBeTruthy();
      expect(screen.queryByTestId('screen-home')).toBeNull();
      expect(screen.queryByTestId('screen-panel')).toBeNull();
      expect(screen.queryByTestId('screen-calendario')).toBeNull();
      expect(screen.queryByTestId('screen-configuracion')).toBeNull();
    });

    it('no existe botón de bypass simulado en la UI pública', async () => {
      render(<App initialEstado="anonimo" />);

      expect(await screen.findByTestId('screen-login')).toBeTruthy();
      expect(screen.queryByText('Simular Iniciar Sesión')).toBeNull();
    });

    it('valida campos obligatorios antes de enviar la petición de login', async () => {
      render(<App initialEstado="anonimo" />);

      expect(await screen.findByTestId('screen-login')).toBeTruthy();

      // Click sin correo
      fireEvent.click(screen.getByTestId('login-submit'));
      expect(await screen.findByText('Ingresa tu correo electrónico.')).toBeTruthy();

      // Escribir correo sin clave
      fireEvent.change(screen.getByTestId('input-correo'), { target: { value: 'test@ojoalgasto.cl' } });
      fireEvent.click(screen.getByTestId('login-submit'));
      expect(await screen.findByText('Ingresa tu contraseña.')).toBeTruthy();
    });

    it('muestra error cuando el backend responde 401 por credenciales incorrectas', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'No active account found with the given credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), { target: { value: 'err@test.cl' } });
      fireEvent.change(screen.getByTestId('input-password'), { target: { value: 'wrongpassword' } });

      fireEvent.click(screen.getByTestId('login-submit'));

      expect(await screen.findByTestId('login-error')).toBeTruthy();
      expect(screen.getByText('Usuario o contraseña inválidos')).toBeTruthy();
      expect(screen.queryByTestId('screen-home')).toBeNull();
    });

    it('inicia sesión con éxito con credenciales válidas y conmuta a Home', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/login/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: jwtValido(),
                refresh_token: 'refresh-real-123',
                usuario: { id: 42, nombre: 'Sebastian Mena', correo: 'sebastian@ojoalgasto.cl' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        if (url.includes('/usuarios/me/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: '42',
                nombre: 'Sebastian Mena',
                correo: 'sebastian@ojoalgasto.cl',
                rol: 'titular',
                organizacion_id: 'org-test',
                plan: 'gratuito',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        return Promise.reject(new Error(`URL no manejada en mock: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), { target: { value: 'sebastian@ojoalgasto.cl' } });
      fireEvent.change(screen.getByTestId('input-password'), { target: { value: 'claveSegura1' } });

      fireEvent.click(screen.getByTestId('login-submit'));

      expect(await screen.findByTestId('screen-home')).toBeTruthy();
      expect(screen.getByText('Home de Suscripciones')).toBeTruthy();
      expect(await screen.findByText(/Usuario: Sebastian Mena/)).toBeTruthy();
      expect(screen.queryByTestId('screen-login')).toBeNull();
    });

    it('login integrado de integrante con plan premium y organización real muestra perfil autorizado [P2]', async () => {
      const USUARIO_INTEGRANTE: Usuario = {
        id: 'usr-val-9',
        nombre: 'Valeria Integrante',
        correo: 'valeria@empresa.cl',
        rol: 'integrante',
        organizacion_id: 'org-empresa-real-9',
        plan: 'premium',
      };

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/login/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: jwtValido(),
                refresh_token: 'refresh-valeria-99',
                usuario: { id: 9, nombre: 'Valeria Integrante', correo: 'valeria@empresa.cl' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        if (url.includes('/usuarios/me/')) {
          return Promise.resolve(
            new Response(JSON.stringify(USUARIO_INTEGRANTE), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        if (url.includes('/suscripciones/')) {
          return Promise.resolve(
            new Response(JSON.stringify(MOCK_SUSCRIPCIONES_API), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`URL no manejada en mock: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), { target: { value: 'valeria@empresa.cl' } });
      fireEvent.change(screen.getByTestId('input-password'), { target: { value: 'claveSeguraValeria1' } });

      fireEvent.click(screen.getByTestId('login-submit'));

      expect(await screen.findByTestId('screen-home')).toBeTruthy();
      expect(await screen.findByText(/Usuario: Valeria Integrante/)).toBeTruthy();

      // Navegar a Configuración -> Perfil para verificar que no inventa titular ni gratuito
      fireEvent.click(screen.getByTestId('tab-configuracion'));
      expect(await screen.findByTestId('screen-configuracion')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-perfil'));
      expect(await screen.findByTestId('screen-perfil')).toBeTruthy();
      expect((await screen.findByTestId('nombre-actual')).textContent).toBe('Valeria Integrante');
      expect((await screen.findByTestId('perfil-correo')).textContent).toBe('valeria@empresa.cl');
      expect((await screen.findByTestId('perfil-rol')).textContent).toBe('integrante');
      expect((await screen.findByTestId('perfil-plan')).textContent).toBe('premium');
    });

    it('permite alternar visibilidad de contraseña (Ver/Ocultar)', async () => {
      render(<App initialEstado="anonimo" />);

      const passInput = screen.getByTestId('input-password') as HTMLInputElement;
      expect(passInput.type).toBe('password');

      fireEvent.click(screen.getByTestId('toggle-password'));
      expect(passInput.type).toBe('text');

      fireEvent.click(screen.getByTestId('toggle-password'));
      expect(passInput.type).toBe('password');
    });

    it('navega a Registro y el botón Volver regresa a Login', async () => {
      render(<App initialEstado="anonimo" />);

      expect(await screen.findByTestId('screen-login')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-registro'));
      expect(await screen.findByTestId('screen-registro')).toBeTruthy();
      expect(screen.getByText('Registro de Cuenta')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-back'));
      expect(await screen.findByTestId('screen-login')).toBeTruthy();
    });

    it('navega a Recuperar Contraseña y vuelve a Login', async () => {
      render(<App initialEstado="anonimo" />);

      expect(await screen.findByTestId('screen-login')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-recuperar'));
      expect(await screen.findByTestId('screen-recuperar-contrasena')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-back'));
      expect(await screen.findByTestId('screen-login')).toBeTruthy();
    });

    it('navega a Verificar Correo y vuelve a Login', async () => {
      render(<App initialEstado="anonimo" />);

      expect(await screen.findByTestId('screen-login')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-verificar'));
      expect(await screen.findByTestId('screen-verificar-correo')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-back'));
      expect(await screen.findByTestId('screen-login')).toBeTruthy();
    });
  });

  describe('Flujo privado (Tabs y Stacks)', () => {
    it('con sesión válida en arnés muestra la pestaña Home', async () => {
      render(<App initialEstado="autenticado" initialUsuario={USUARIO} />);

      expect(await screen.findByTestId('screen-home')).toBeTruthy();
      expect(screen.getByText('Home de Suscripciones')).toBeTruthy();
      expect(screen.getByText(/Usuario: Sebastian Mena/)).toBeTruthy();
      expect(screen.queryByTestId('screen-login')).toBeNull();
    });

    it('navega a SuscripcionDetalle con parámetro obligatorio id y vuelve a Home', async () => {
      render(<App initialEstado="autenticado" initialUsuario={USUARIO} />);

      expect(await screen.findByTestId('screen-home')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-detalle'));
      expect(await screen.findByTestId('screen-suscripcion-detalle')).toBeTruthy();
      expect(screen.getByText('ID Suscripción: 1')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-back'));
      expect(await screen.findByTestId('screen-home')).toBeTruthy();
    });

    it('navega a SuscripcionNueva y vuelve a Home', async () => {
      render(<App initialEstado="autenticado" initialUsuario={USUARIO} />);

      expect(await screen.findByTestId('screen-home')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-nueva-suscripcion'));
      expect(await screen.findByTestId('screen-suscripcion-nueva')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-back'));
      expect(await screen.findByTestId('screen-home')).toBeTruthy();
    });

    it('logout desde Home conmuta de inmediato a Login sin retorno a rutas privadas', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="autenticado" initialUsuario={USUARIO} />);

      expect(await screen.findByTestId('screen-home')).toBeTruthy();

      fireEvent.click(screen.getByTestId('logout'));

      expect(await screen.findByTestId('screen-login')).toBeTruthy();
      expect(screen.queryByTestId('screen-home')).toBeNull();
      expect(screen.queryByTestId('screen-detalle')).toBeNull();
    });

    describe('Volver a Login cuando la sesión móvil no sea válida (SE-16)', () => {
      it('Criterio 1: Refresh válido ante un 401 mantiene la sesión y permanece en la pantalla privada', async () => {
        const tokenOriginal = jwtValido();
        const tokenNuevo = jwtValido(Math.floor(Date.now() / 1000) + 7200);
        guardarTokens({ access_token: tokenOriginal, refresh_token: 'refresh-valido' });

        const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          if (typeof url === 'string' && url.includes('/auth/refresh/')) {
            return new Response(
              JSON.stringify({
                access_token: tokenNuevo,
                refresh_token: 'refresh-rotado-456',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          const auth = (init?.headers as Record<string, string>)?.Authorization;
          if (auth === `Bearer ${tokenNuevo}`) {
            return new Response(JSON.stringify({ resultado: 'ok' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ detail: 'Token expirado' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<App initialEstado="autenticado" initialUsuario={USUARIO} />);
        expect(await screen.findByTestId('screen-home')).toBeTruthy();

        // Ejecutar petición protegida que sufre 401 pero se renueva con éxito
        let resultado: unknown;
        await act(async () => {
          resultado = await pedir('/suscripciones/');
        });

        expect(resultado).toEqual({ resultado: 'ok' });
        // Se mantiene en la pantalla privada y no vuelve a Login
        expect(screen.getByTestId('screen-home')).toBeTruthy();
        expect(screen.queryByTestId('screen-login')).toBeNull();
        expect(obtenerAccessToken()).toBe(tokenNuevo);
      });

      it('Criterio 2: Refresh inválido ante un 401 limpia tokens y conmuta a Login una sola vez', async () => {
        const tokenExpirado = jwtValido();
        guardarTokens({ access_token: tokenExpirado, refresh_token: 'refresh-invalido' });

        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
          if (typeof url === 'string' && url.includes('/auth/refresh/')) {
            return new Response(JSON.stringify({ detail: 'Refresh token inválido o revocado' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ detail: 'Token inválido' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<App initialEstado="autenticado" initialUsuario={USUARIO} />);
        expect(await screen.findByTestId('screen-home')).toBeTruthy();

        // Petición protegida con refresh rechazado
        await act(async () => {
          try {
            await pedir('/suscripciones/');
          } catch {
            // ErrorDeApi esperado
          }
        });

        // La navegación desmonta las rutas privadas y muestra Login
        expect(await screen.findByTestId('screen-login')).toBeTruthy();
        expect(screen.queryByTestId('screen-home')).toBeNull();
        expect(screen.queryByTestId('screen-detalle')).toBeNull();
        expect(obtenerAccessToken()).toBeNull();
      });

      it('Diferenciación: Error 403 Forbidden o error de red NO cierra la sesión ni vuelve a Login', async () => {
        const tokenValido = jwtValido();
        guardarTokens({ access_token: tokenValido, refresh_token: 'refresh-123' });

        // Simular respuesta 403 Forbidden
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ detail: 'No tienes permisos para este recurso' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        );
        vi.stubGlobal('fetch', fetchMock);

        render(<App initialEstado="autenticado" initialUsuario={USUARIO} />);
        expect(await screen.findByTestId('screen-home')).toBeTruthy();

        await act(async () => {
          try {
            await pedir('/admin-zona/');
          } catch {
            // ErrorDeApi esperado con 403
          }
        });

        // La sesión y la pantalla Home se mantienen intactas
        expect(screen.getByTestId('screen-home')).toBeTruthy();
        expect(screen.queryByTestId('screen-login')).toBeNull();
        expect(obtenerAccessToken()).toBe(tokenValido);
      });
    });
  });
});


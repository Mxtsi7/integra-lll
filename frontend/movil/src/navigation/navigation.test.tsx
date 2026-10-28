// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type Usuario, configurarTokenStorage } from '@ojoalgasto/shared';
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
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: jwtValido(),
            refresh_token: 'refresh-real-123',
            usuario: { id: 42, nombre: 'Sebastian Mena', correo: 'sebastian@ojoalgasto.cl' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
      vi.stubGlobal('fetch', fetchMock);

      render(<App initialEstado="anonimo" />);

      fireEvent.change(screen.getByTestId('input-correo'), { target: { value: 'sebastian@ojoalgasto.cl' } });
      fireEvent.change(screen.getByTestId('input-password'), { target: { value: 'claveSegura1' } });

      fireEvent.click(screen.getByTestId('login-submit'));

      expect(await screen.findByTestId('screen-home')).toBeTruthy();
      expect(screen.getByText('Home de Suscripciones')).toBeTruthy();
      expect(screen.getByText(/Usuario: Sebastian Mena/)).toBeTruthy();
      expect(screen.queryByTestId('screen-login')).toBeNull();
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

      // Validación de integración con cálculo en vivo de shared
      expect(screen.getByTestId('card-costo-por-hora')).toBeTruthy();
      expect(screen.getByTestId('resultado-costo-hora')).toBeTruthy();

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
  });
});

/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthError } from '@ojoalgasto/shared';
import { InicioConGoogle } from './InicioConGoogle';

const { sesion } = vi.hoisted(() => ({ sesion: { actual: 1 } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ capturarSesion: () => sesion.actual }) }));

const TOKENS = { access_token: 'acceso', refresh_token: 'refresco' };
const nonce = (n: string) => ({ nonce: n, client_id: 'cliente-1', vence_en_segundos: 300 });

type Config = { client_id: string; nonce: string; callback: (r: { credential: string }) => void };

/** Un "Google" de mentira: guarda la configuración con la que se dibuja el botón. */
function google() {
  const configuraciones: Config[] = [];
  const api = {
    initialize: vi.fn((config: Config) => configuraciones.push(config)),
    renderButton: vi.fn(),
  };
  return { api, configuraciones, ultima: () => configuraciones[configuraciones.length - 1] };
}

function montar(opciones: {
  nonces?: Array<ReturnType<typeof nonce>>;
  iniciar?: ReturnType<typeof vi.fn>;
  alIniciarSesion?: ReturnType<typeof vi.fn>;
  pedirNonce?: ReturnType<typeof vi.fn>;
  g?: ReturnType<typeof google>;
}) {
  const g = opciones.g ?? google();
  const lista = [...(opciones.nonces ?? [nonce('n1'), nonce('n2'), nonce('n3')])];
  const pedirNonce = opciones.pedirNonce ?? vi.fn(async () => lista.shift()!);
  const iniciar = opciones.iniciar ?? vi.fn().mockResolvedValue(TOKENS);
  const alIniciarSesion = opciones.alIniciarSesion ?? vi.fn();
  render(
    <MemoryRouter>
      <InicioConGoogle
        alIniciarSesion={alIniciarSesion as never}
        pedirNonce={pedirNonce as never}
        iniciarConGoogle={iniciar as never}
        cargarGoogle={(async () => g.api) as never}
      />
    </MemoryRouter>,
  );
  return { g, pedirNonce, iniciar, alIniciarSesion };
}

// Deja pasar una macrotarea: así terminan las cadenas de promesas (pedir el nonce,
// cargar Google, responder) antes de mirar la pantalla.
const esperar = () => new Promise((resolver) => setTimeout(resolver, 0));

async function listo() {
  await act(async () => {
    await esperar();
  });
}

async function tocar(g: ReturnType<typeof google>, credential = 'credencial-1') {
  await act(async () => {
    g.ultima().callback({ credential });
    await esperar();
  });
}

describe('InicioConGoogle (S3-AN-07)', () => {
  beforeEach(() => {
    sesion.actual = 1;
  });
  afterEach(cleanup);

  it('dibuja el botón con el client_id y el nonce que da el backend', async () => {
    const { g, pedirNonce } = montar({});
    await listo();

    expect(pedirNonce).toHaveBeenCalledTimes(1);
    expect(g.api.initialize).toHaveBeenCalledTimes(1);
    expect(g.ultima()).toMatchObject({ client_id: 'cliente-1', nonce: 'n1' });
    expect(g.api.renderButton).toHaveBeenCalledTimes(1);
  });

  it('una credencial válida entra con la sesión propia y no pide otro nonce', async () => {
    const { g, iniciar, alIniciarSesion, pedirNonce } = montar({});
    await listo();
    await tocar(g);

    expect(iniciar).toHaveBeenCalledWith({ idToken: 'credencial-1', nonce: 'n1', password: undefined });
    expect(alIniciarSesion).toHaveBeenCalledWith(TOKENS);
    expect(pedirNonce).toHaveBeenCalledTimes(1);
  });

  it('cuenta existente: pide la contraseña, usa un nonce nuevo y recién entonces entra', async () => {
    const iniciar = vi
      .fn()
      .mockRejectedValueOnce(new AuthError('Confirma tu contraseña', 401, { codigo: 'vincular_google' }))
      .mockResolvedValueOnce(TOKENS);
    const { g, alIniciarSesion } = montar({ iniciar });
    await listo();
    await tocar(g);

    expect(alIniciarSesion).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Ya tienes una cuenta con este correo/);
    expect(g.ultima().nonce).toBe('n2'); // el nonce anterior ya se gastó

    fireEvent.change(screen.getByLabelText('Contraseña de tu cuenta'), { target: { value: 'Clave123' } });
    await tocar(g, 'credencial-2');

    expect(iniciar).toHaveBeenLastCalledWith({ idToken: 'credencial-2', nonce: 'n2', password: 'Clave123' });
    expect(alIniciarSesion).toHaveBeenCalledTimes(1);
  });

  it('con una contraseña que no coincide lo dice y no entra', async () => {
    const iniciar = vi.fn().mockRejectedValue(new AuthError('x', 401, { codigo: 'vincular_google' }));
    const { g, alIniciarSesion } = montar({ iniciar });
    await listo();
    await tocar(g);
    fireEvent.change(screen.getByLabelText('Contraseña de tu cuenta'), { target: { value: 'incorrecta1' } });
    await tocar(g, 'credencial-2');

    expect(screen.getByRole('alert').textContent).toMatch(/La contraseña no es correcta/);
    expect(alIniciarSesion).not.toHaveBeenCalled();
  });

  it('sin cuenta con ese correo no crea sesión y manda a registrarse', async () => {
    const iniciar = vi.fn().mockRejectedValue(new AuthError('x', 409, { codigo: 'completar_registro' }));
    const { g, alIniciarSesion } = montar({ iniciar });
    await listo();
    await tocar(g);

    expect(alIniciarSesion).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Regístrate primero/);
    expect(screen.getByRole('link', { name: 'Crear una cuenta' }).getAttribute('href')).toBe('/registro');
  });

  it.each([
    ['google_cancelado', 400, /Cancelaste el inicio con Google/],
    ['google_invalido', 401, /No pudimos validar tu cuenta de Google/],
  ])('%s: avisa, no crea sesión y deja intentar con un nonce nuevo', async (codigo, estado, texto) => {
    const iniciar = vi.fn().mockRejectedValue(new AuthError('x', estado, { codigo }));
    const { g, alIniciarSesion, pedirNonce } = montar({ iniciar });
    await listo();
    await tocar(g);

    expect(screen.getByRole('alert').textContent).toMatch(texto);
    expect(alIniciarSesion).not.toHaveBeenCalled();
    expect(pedirNonce).toHaveBeenCalledTimes(2);
  });

  it('un 503 muestra el mensaje del servidor y un fallo de red lo distingue', async () => {
    const iniciar = vi
      .fn()
      .mockRejectedValueOnce(new AuthError('No se pudo iniciar sesión. Inténtalo nuevamente.', 503, { codigo: 'google_no_disponible' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { g } = montar({ iniciar });
    await listo();
    await tocar(g);
    expect(screen.getByRole('alert').textContent).toMatch(/No se pudo iniciar sesión/);
    await tocar(g);
    expect(screen.getByRole('alert').textContent).toMatch(/No pudimos conectar con el servidor/);
  });

  it('si el servidor no tiene Google configurado no ofrece el botón', async () => {
    const pedirNonce = vi.fn().mockRejectedValue(new AuthError('x', 503, { codigo: 'google_no_configurado' }));
    const { g } = montar({ pedirNonce });
    await listo();

    expect(screen.queryByTestId('boton-google')).toBeNull();
    expect(g.api.renderButton).not.toHaveBeenCalled();
  });

  it('si no se puede cargar Google lo dice, y Reintentar vuelve a pedirlo', async () => {
    const pedirNonce = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(nonce('n1'));
    const { g } = montar({ pedirNonce });
    await listo();

    expect(screen.getByText(/No pudimos cargar el inicio con Google/)).toBeTruthy();
    expect(g.api.renderButton).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar con Google' }));
      await esperar();
    });
    expect(g.api.renderButton).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No pudimos cargar el inicio con Google/)).toBeNull();
  });

  it('la credencial de un intento anterior se ignora', async () => {
    const iniciar = vi.fn().mockRejectedValue(new AuthError('x', 401, { codigo: 'google_invalido' }));
    const { g } = montar({ iniciar });
    await listo();
    const vieja = g.ultima().callback;
    await tocar(g); // gasta n1 y se prepara n2
    expect(iniciar).toHaveBeenCalledTimes(1);

    await act(async () => {
      vieja({ credential: 'credencial-vieja' });
      await esperar();
    });
    expect(iniciar).toHaveBeenCalledTimes(1);
  });

  it('dos toques seguidos mandan una sola solicitud', async () => {
    let resolver!: (t: typeof TOKENS) => void;
    const iniciar = vi.fn(() => new Promise<typeof TOKENS>((r) => (resolver = r)));
    const { g, alIniciarSesion } = montar({ iniciar });
    await listo();
    await act(async () => {
      g.ultima().callback({ credential: 'a' });
      g.ultima().callback({ credential: 'b' });
      await esperar();
    });
    expect(iniciar).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver(TOKENS);
      await esperar();
    });
    expect(alIniciarSesion).toHaveBeenCalledTimes(1);
  });

  it('si mientras se esperaba cambió la sesión, la respuesta no inicia otra', async () => {
    let resolver!: (t: typeof TOKENS) => void;
    const iniciar = vi.fn(() => new Promise<typeof TOKENS>((r) => (resolver = r)));
    const { g, alIniciarSesion } = montar({ iniciar });
    await listo();
    await act(async () => {
      g.ultima().callback({ credential: 'a' });
      await esperar();
    });

    sesion.actual = 2; // entró otra sesión (p. ej. en otra pestaña)
    await act(async () => {
      resolver(TOKENS);
      await esperar();
    });

    expect(alIniciarSesion).not.toHaveBeenCalled();
  });

  it('si guardar la sesión falla no se muestra éxito y se puede reintentar', async () => {
    const alIniciarSesion = vi.fn(() => {
      throw new Error('token inválido');
    });
    const { g, pedirNonce } = montar({ alIniciarSesion });
    await listo();
    await tocar(g);

    expect(screen.getByRole('alert').textContent).toMatch(/No pudimos iniciar sesión con Google/);
    expect(pedirNonce).toHaveBeenCalledTimes(2);
  });
});

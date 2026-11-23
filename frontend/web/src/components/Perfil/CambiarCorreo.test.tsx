/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthError } from '@ojoalgasto/shared';
import { CambiarCorreo } from './CambiarCorreo';

const { sesion } = vi.hoisted(() => ({ sesion: { actual: 1 } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ capturarSesion: () => sesion.actual }) }));

const ACTUAL = 'ana@ejemplo.com';

function abrir(onSolicitar: (d: { correo: string; password: string }) => Promise<void>, alCerrar = vi.fn()) {
  render(<CambiarCorreo correoActual={ACTUAL} alCerrar={alCerrar} onSolicitar={onSolicitar} />);
  return alCerrar;
}

function completar(correo = 'nuevo@ejemplo.com', password = 'Clave123') {
  fireEvent.change(screen.getByLabelText('Correo nuevo'), { target: { value: correo } });
  fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: password } });
}

// Una macrotarea para que terminen las promesas antes de mirar la pantalla.
const esperar = () => new Promise((resolver) => setTimeout(resolver, 0));

async function enviar() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    await esperar();
  });
}

describe('CambiarCorreo (S3-AN-02)', () => {
  beforeEach(() => {
    sesion.actual = 1;
  });
  afterEach(cleanup);

  it('no envía nada si falta el correo, la contraseña o el correo es el mismo de siempre', async () => {
    const onSolicitar = vi.fn();
    abrir(onSolicitar);

    await enviar();
    expect(screen.getByText('Ingresa tu correo electrónico.')).toBeTruthy();
    expect(screen.getByText('Escribe tu contraseña actual.')).toBeTruthy();

    completar('correo-mal', 'Clave123');
    await enviar();
    expect(screen.getByText('Ingresa un correo electrónico válido.')).toBeTruthy();

    completar('  ANA@ejemplo.com ', 'Clave123');
    await enviar();
    expect(screen.getByText('Es el mismo correo que ya usas.')).toBeTruthy();

    expect(onSolicitar).not.toHaveBeenCalled();
  });

  it('manda el correo nuevo con la contraseña y avisa que el actual sigue activo hasta confirmar', async () => {
    const onSolicitar = vi.fn().mockResolvedValue(undefined);
    abrir(onSolicitar);
    completar();
    await enviar();

    expect(onSolicitar).toHaveBeenCalledWith({ correo: 'nuevo@ejemplo.com', password: 'Clave123' });
    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toContain('Te enviamos un enlace a nuevo@ejemplo.com');
    expect(screen.getByText(ACTUAL)).toBeTruthy(); // sigue siendo el correo vigente
    expect(screen.getByText(/Mientras no lo confirmes/)).toBeTruthy();
  });

  it('contraseña incorrecta: el error va bajo su campo y no hay aviso de envío', async () => {
    abrir(vi.fn().mockRejectedValue(new AuthError('x', 400, { codigo: 'identidad_invalida' })));
    completar();
    await enviar();

    expect(screen.getByText('La contraseña no es correcta.')).toBeTruthy();
    expect(screen.queryByText(/Te enviamos un enlace/)).toBeNull();
    expect(screen.getByLabelText('Contraseña actual').getAttribute('aria-invalid')).toBe('true');
  });

  it('correo ocupado: el error va bajo el correo, no bajo la contraseña', async () => {
    abrir(vi.fn().mockRejectedValue(new AuthError('x', 400, { codigo: 'correo_no_disponible' })));
    completar();
    await enviar();

    expect(screen.getByText('Ese correo no está disponible. Prueba con otro.')).toBeTruthy();
    expect(screen.queryByText('La contraseña no es correcta.')).toBeNull();
  });

  it('límite de reenvío, sesión vencida, sin red y 503 se distinguen y no muestran éxito', async () => {
    const casos: Array<[unknown, RegExp]> = [
      [new AuthError('x', 429, { codigo: 'limite_reenvio' }), /demasiados enlaces/],
      [new AuthError('x', 401), /sesión expiró/],
      [new TypeError('Failed to fetch'), /No pudimos conectar con el servidor/],
      [new AuthError('No se pudo enviar el correo. Inténtalo nuevamente.', 503), /No se pudo enviar el correo/],
    ];
    for (const [error, texto] of casos) {
      cleanup();
      abrir(vi.fn().mockRejectedValue(error));
      completar();
      await enviar();
      expect(screen.getByRole('alert').textContent).toMatch(texto);
      expect(screen.queryByText(/Te enviamos un enlace/)).toBeNull();
    }
  });

  it('un doble toque manda una sola solicitud y no deja cancelar mientras se envía', async () => {
    let resolver!: () => void;
    const onSolicitar = vi.fn(() => new Promise<void>((r) => (resolver = r)));
    const alCerrar = abrir(onSolicitar);
    completar();

    const boton = screen.getByRole('button', { name: 'Enviar enlace' });
    await act(async () => {
      fireEvent.click(boton);
      fireEvent.click(boton);
      await esperar();
    });
    expect(onSolicitar).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(alCerrar).not.toHaveBeenCalled();

    await act(async () => {
      resolver();
      await esperar();
    });
    expect(screen.getByRole('status').textContent).toContain('Te enviamos un enlace');
  });

  it('si mientras se enviaba cambió la sesión, no muestra el resultado como propio', async () => {
    let resolver!: () => void;
    const alCerrar = abrir(vi.fn(() => new Promise<void>((r) => (resolver = r))));
    completar();
    await enviar();

    sesion.actual = 2; // se cerró la sesión o entró otra cuenta
    await act(async () => {
      resolver();
      await esperar();
    });

    expect(screen.queryByText(/Te enviamos un enlace/)).toBeNull();
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });
});

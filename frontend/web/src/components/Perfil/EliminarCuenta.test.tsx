/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthError } from '@ojoalgasto/shared';
import { EliminarCuenta } from './EliminarCuenta';

const { navegar, cerrarSesionLocal, exito } = vi.hoisted(() => ({
  navegar: vi.fn(),
  cerrarSesionLocal: vi.fn(),
  exito: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navegar }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ cerrarSesionLocal }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ exito }) }));

function abrir(onEliminar: (d: unknown) => Promise<unknown>) {
  render(<EliminarCuenta onEliminar={onEliminar as never} disponible />);
  fireEvent.click(screen.getByRole('button', { name: /^Eliminar$/ }));
}

function completar() {
  fireEvent.change(screen.getByLabelText('Tu contraseña actual'), { target: { value: 'Clave123' } });
  fireEvent.change(screen.getByLabelText('Escribe ELIMINAR para confirmar'), {
    target: { value: 'ELIMINAR' },
  });
}

function botonConfirmar() {
  return screen.getByRole('button', { name: 'Eliminar mi cuenta' }) as HTMLButtonElement;
}

describe('EliminarCuenta (AN-18)', () => {
  beforeEach(() => {
    navegar.mockReset();
    cerrarSesionLocal.mockReset();
    exito.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('sin backend disponible el botón queda deshabilitado y no abre el diálogo', () => {
    render(<EliminarCuenta onEliminar={vi.fn()} disponible={false} />);
    const boton = screen.getByRole('button', { name: /^Eliminar$/ }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    fireEvent.click(boton);
    expect(screen.queryByLabelText('Tu contraseña actual')).toBeNull();
  });

  it('el botón de confirmar sigue deshabilitado hasta tener contraseña y escribir ELIMINAR', () => {
    abrir(vi.fn());
    expect(botonConfirmar().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Tu contraseña actual'), { target: { value: 'Clave123' } });
    expect(botonConfirmar().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Escribe ELIMINAR para confirmar'), {
      target: { value: 'eliminar' },
    });
    expect(botonConfirmar().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Escribe ELIMINAR para confirmar'), {
      target: { value: 'ELIMINAR' },
    });
    expect(botonConfirmar().disabled).toBe(false);
  });

  it('informa de la limitación de Outlook antes de confirmar la eliminación', () => {
    const onEliminar = vi.fn();
    abrir(onEliminar);
    expect(screen.getByText(/Microsoft no revoca automáticamente ese acceso/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retirar el acceso en tu cuenta Microsoft personal' }).getAttribute('href'))
      .toBe('https://account.live.com/consent/Manage');
    expect(botonConfirmar().disabled).toBe(true);
    expect(onEliminar).not.toHaveBeenCalled();
  });

  it('Cancelar cierra el diálogo sin hacer petición ni tocar la sesión', () => {
    const onEliminar = vi.fn();
    abrir(onEliminar);
    completar();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Tu contraseña actual')).toBeNull();
    expect(onEliminar).not.toHaveBeenCalled();
    expect(cerrarSesionLocal).not.toHaveBeenCalled();
  });

  it('Escape cierra el diálogo sin hacer petición ni tocar la sesión', () => {
    const onEliminar = vi.fn();
    abrir(onEliminar);
    completar();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByLabelText('Tu contraseña actual')).toBeNull();
    expect(onEliminar).not.toHaveBeenCalled();
    expect(cerrarSesionLocal).not.toHaveBeenCalled();
  });

  it('204: cierra la sesión local, avisa y va a /login', async () => {
    const onEliminar = vi.fn().mockResolvedValue({ estado: 'eliminada' });
    abrir(onEliminar);
    completar();
    fireEvent.click(botonConfirmar());
    await waitFor(() => expect(cerrarSesionLocal).toHaveBeenCalledTimes(1));
    expect(onEliminar).toHaveBeenCalledWith({ password: 'Clave123', confirmacion: 'ELIMINAR' });
    expect(exito).toHaveBeenCalledWith('Tu cuenta fue eliminada y cerramos tu sesión.');
    expect(navegar).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('202: cierra la sesión pero avisa que la eliminación sigue en curso', async () => {
    const onEliminar = vi.fn().mockResolvedValue({ estado: 'pendiente', operacionId: 'op-1' });
    abrir(onEliminar);
    completar();
    fireEvent.click(botonConfirmar());
    await waitFor(() => expect(cerrarSesionLocal).toHaveBeenCalledTimes(1));
    expect(exito.mock.calls[0][0]).toContain('todavía no termina');
    expect(navegar).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('403: pide revisar la contraseña y NO cierra la sesión', async () => {
    const onEliminar = vi.fn().mockRejectedValue(new AuthError('no', 403));
    abrir(onEliminar);
    completar();
    fireEvent.click(botonConfirmar());
    await screen.findByText('No pudimos confirmar tu identidad. Revisa tu contraseña.');
    expect(cerrarSesionLocal).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });

  it('409: pide confirmar la organización y reenvía con confirmacion_organizacion', async () => {
    const onEliminar = vi
      .fn()
      .mockRejectedValueOnce(new AuthError('ultimo titular', 409))
      .mockResolvedValueOnce({ estado: 'eliminada' });
    abrir(onEliminar);
    completar();
    fireEvent.click(botonConfirmar());
    await screen.findByText(/última persona titular de tu organización/);
    expect(cerrarSesionLocal).not.toHaveBeenCalled();
    expect(botonConfirmar().disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(botonConfirmar().disabled).toBe(false);
    fireEvent.click(botonConfirmar());

    await waitFor(() => expect(cerrarSesionLocal).toHaveBeenCalledTimes(1));
    expect(onEliminar).toHaveBeenLastCalledWith({
      password: 'Clave123',
      confirmacion: 'ELIMINAR',
      confirmacion_organizacion: 'ELIMINAR',
    });
  });

  it('503: dice que la cuenta sigue activa y NO cierra la sesión', async () => {
    const onEliminar = vi.fn().mockRejectedValue(new AuthError('caído', 503));
    abrir(onEliminar);
    completar();
    fireEvent.click(botonConfirmar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Tu cuenta sigue activa');
    expect(cerrarSesionLocal).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });

  it('error de red: avisa de la conexión y NO cierra la sesión', async () => {
    const onEliminar = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    abrir(onEliminar);
    completar();
    fireEvent.click(botonConfirmar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('conectar con el servidor');
    expect(cerrarSesionLocal).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });
});

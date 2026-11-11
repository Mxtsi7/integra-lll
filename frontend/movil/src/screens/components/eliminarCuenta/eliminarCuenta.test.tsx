// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthError } from '@ojoalgasto/shared';
import { EliminarCuentaContenido } from './EliminarCuentaContenido';
import { describirErrorDeEliminacion } from './reglasEliminacion';

function montar(cambios: Partial<React.ComponentProps<typeof EliminarCuentaContenido>> = {}) {
  const props = {
    onEliminada: vi.fn(),
    onCancelar: vi.fn(),
    onEliminar: vi.fn().mockResolvedValue({ estado: 'eliminada' }),
    disponible: true,
    ...cambios,
  };
  render(<EliminarCuentaContenido {...props} />);
  return props;
}

function llenar(contrasena = 'secreta123', texto = 'ELIMINAR') {
  fireEvent.change(screen.getByTestId('input-contrasena'), { target: { value: contrasena } });
  fireEvent.change(screen.getByTestId('input-confirmacion'), { target: { value: texto } });
}

afterEach(() => {
  cleanup();
});

describe('describirErrorDeEliminacion', () => {
  it('cada código del backend tiene su mensaje y lugar', () => {
    expect(describirErrorDeEliminacion(new AuthError('x', 409)).pideConfirmarOrganizacion).toBe(true);
    expect(describirErrorDeEliminacion(new AuthError('x', 403)).lugar).toBe('contrasena');
    expect(describirErrorDeEliminacion(new AuthError('x', 400)).lugar).toBe('general');
    expect(describirErrorDeEliminacion(new AuthError('x', 503)).mensaje).toContain('sigue activa');
    expect(describirErrorDeEliminacion(new TypeError('red')).mensaje).toContain('conexión');
    expect(describirErrorDeEliminacion(new Error('raro')).lugar).toBe('general');
  });
});

describe('Eliminar cuenta móvil (AN-19)', () => {
  it('con el backend no disponible no muestra el formulario', () => {
    montar({ disponible: false });
    expect(screen.getByTestId('eliminar-no-disponible')).toBeTruthy();
    expect(screen.queryByTestId('input-contrasena')).toBeNull();
  });

  it('el botón de eliminar espera la contraseña y la palabra ELIMINAR', () => {
    montar();
    const boton = screen.getByTestId('confirmar-eliminacion') as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    llenar('secreta123', 'eliminar');
    expect(boton.disabled).toBe(true);
    llenar('secreta123', 'ELIMINAR');
    expect(boton.disabled).toBe(false);
  });

  it('cancelar vuelve atrás sin llamar al backend ni cerrar la sesión', () => {
    const props = montar();
    llenar();
    fireEvent.click(screen.getByTestId('cancelar-eliminacion'));
    expect(props.onCancelar).toHaveBeenCalledTimes(1);
    expect(props.onEliminar).not.toHaveBeenCalled();
    expect(props.onEliminada).not.toHaveBeenCalled();
  });

  it('con la confirmación aceptada envía los datos y recién entonces avisa para cerrar la sesión', async () => {
    const props = montar();
    llenar();
    fireEvent.click(screen.getByTestId('confirmar-eliminacion'));
    await waitFor(() => expect(props.onEliminada).toHaveBeenCalledWith({ estado: 'eliminada' }));
    expect(props.onEliminar).toHaveBeenCalledWith({ password: 'secreta123', confirmacion: 'ELIMINAR' });
  });

  it('un resultado pendiente (202) también cierra la sesión', async () => {
    const props = montar({ onEliminar: vi.fn().mockResolvedValue({ estado: 'pendiente', operacionId: 'op-1' }) });
    llenar();
    fireEvent.click(screen.getByTestId('confirmar-eliminacion'));
    await waitFor(() => expect(props.onEliminada).toHaveBeenCalledWith({ estado: 'pendiente', operacionId: 'op-1' }));
  });

  it('contraseña incorrecta (403): lo dice junto al campo y no cierra la sesión', async () => {
    const props = montar({ onEliminar: vi.fn().mockRejectedValue(new AuthError('no', 403)) });
    llenar();
    fireEvent.click(screen.getByTestId('confirmar-eliminacion'));
    expect(await screen.findByTestId('error-contrasena')).toBeTruthy();
    expect(props.onEliminada).not.toHaveBeenCalled();
  });

  it('último titular (409): pide confirmar la organización y la reenvía', async () => {
    const onEliminar = vi.fn().mockRejectedValueOnce(new AuthError('titular', 409)).mockResolvedValue({ estado: 'eliminada' });
    const props = montar({ onEliminar });
    llenar();
    fireEvent.click(screen.getByTestId('confirmar-eliminacion'));
    fireEvent.click(await screen.findByTestId('confirmar-organizacion'));
    fireEvent.click(screen.getByTestId('confirmar-eliminacion'));
    await waitFor(() => expect(props.onEliminada).toHaveBeenCalledTimes(1));
    expect(onEliminar).toHaveBeenLastCalledWith({ password: 'secreta123', confirmacion: 'ELIMINAR', confirmacion_organizacion: 'ELIMINAR' });
  });

  it('si no hay servidor (503) avisa que la cuenta sigue activa y no cierra la sesión', async () => {
    const props = montar({ onEliminar: vi.fn().mockRejectedValue(new AuthError('caído', 503)) });
    llenar();
    fireEvent.click(screen.getByTestId('confirmar-eliminacion'));
    expect((await screen.findByTestId('error-general')).textContent).toContain('sigue activa');
    expect(props.onEliminada).not.toHaveBeenCalled();
  });

  it('un doble toque manda una sola petición', async () => {
    const props = montar();
    llenar();
    const boton = screen.getByTestId('confirmar-eliminacion');
    fireEvent.click(boton);
    fireEvent.click(boton);
    await waitFor(() => expect(props.onEliminada).toHaveBeenCalledTimes(1));
    expect(props.onEliminar).toHaveBeenCalledTimes(1);
  });
});

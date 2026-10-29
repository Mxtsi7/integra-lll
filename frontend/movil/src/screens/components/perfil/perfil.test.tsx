// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorDeApi, type Usuario } from '@ojoalgasto/shared';
import { PerfilContenido } from './PerfilContenido';

const USUARIO: Usuario = {
  id: 'usr-1',
  nombre: 'Ana Pérez',
  correo: 'ana@correo.cl',
  rol: 'titular',
  organizacion_id: 'org-1',
  plan: 'gratuito',
};

function montar(onGuardarNombre = vi.fn().mockResolvedValue(undefined)) {
  render(<PerfilContenido usuario={USUARIO} onGuardarNombre={onGuardarNombre} />);
  return onGuardarNombre;
}

function editarA(texto: string) {
  fireEvent.click(screen.getByTestId('editar-nombre'));
  fireEvent.change(screen.getByTestId('input-nombre'), { target: { value: texto } });
}

afterEach(() => {
  cleanup();
});

describe('Perfil móvil (AN-03)', () => {
  it('muestra los datos del usuario de la sesión', () => {
    montar();
    expect(screen.getByTestId('nombre-actual').textContent).toBe('Ana Pérez');
    expect(screen.getByTestId('perfil-correo').textContent).toBe('ana@correo.cl');
    expect(screen.getByTestId('perfil-rol').textContent).toBe('titular');
    expect(screen.getByTestId('perfil-plan').textContent).toBe('gratuito');
    expect(screen.getByTestId('perfil-organizacion').textContent).toBe('org-1');
  });

  it('solo el nombre es editable: no hay campos para rol ni organización', () => {
    montar();
    fireEvent.click(screen.getByTestId('editar-nombre'));
    expect(screen.getAllByTestId('input-nombre')).toHaveLength(1);
  });

  it('cancelar vuelve a la vista sin llamar al servidor', () => {
    const onGuardar = montar();
    editarA('Otro nombre');
    fireEvent.click(screen.getByTestId('cancelar-nombre'));
    expect(screen.queryByTestId('input-nombre')).toBeNull();
    expect(screen.getByTestId('nombre-actual').textContent).toBe('Ana Pérez');
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('guarda el nombre sin espacios sobrantes y envía solo el nombre', async () => {
    const onGuardar = montar();
    editarA('  Ana María  ');
    fireEvent.click(screen.getByTestId('guardar-nombre'));
    await waitFor(() => expect(screen.queryByTestId('input-nombre')).toBeNull());
    expect(onGuardar).toHaveBeenCalledTimes(1);
    expect(onGuardar).toHaveBeenCalledWith('Ana María');
  });

  it('un nombre vacío no se envía y muestra el error', () => {
    const onGuardar = montar();
    editarA('   ');
    fireEvent.click(screen.getByTestId('guardar-nombre'));
    expect(screen.getByTestId('error-nombre')).toBeTruthy();
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('si el nombre no cambió, no hace petición', () => {
    const onGuardar = montar();
    editarA('Ana Pérez');
    fireEvent.click(screen.getByTestId('guardar-nombre'));
    expect(screen.queryByTestId('input-nombre')).toBeNull();
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('mientras guarda deshabilita los botones y un doble toque no guarda dos veces', async () => {
    let terminar!: () => void;
    const onGuardar = vi.fn().mockReturnValue(
      new Promise<void>((resolver) => {
        terminar = resolver;
      }),
    );
    montar(onGuardar);
    editarA('Ana María');
    fireEvent.click(screen.getByTestId('guardar-nombre'));
    fireEvent.click(screen.getByTestId('guardar-nombre'));
    expect(onGuardar).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('guardar-nombre') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('cancelar-nombre') as HTMLButtonElement).disabled).toBe(true);
    terminar();
    await waitFor(() => expect(screen.queryByTestId('input-nombre')).toBeNull());
  });

  it('si el servidor rechaza, sigue en edición con el error y no da el cambio por guardado', async () => {
    const onGuardar = montar(vi.fn().mockRejectedValue(new ErrorDeApi('no', 403)));
    editarA('Ana María');
    fireEvent.click(screen.getByTestId('guardar-nombre'));
    const error = await screen.findByTestId('error-nombre');
    expect(error.textContent).toContain('sesión');
    expect(screen.getByTestId('input-nombre')).toBeTruthy();
    expect(onGuardar).toHaveBeenCalledTimes(1);
  });

  it('si no hay conexión, avisa y permite reintentar', async () => {
    montar(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    editarA('Ana María');
    fireEvent.click(screen.getByTestId('guardar-nombre'));
    const error = await screen.findByTestId('error-nombre');
    expect(error.textContent).toContain('conectar');
    expect((screen.getByTestId('guardar-nombre') as HTMLButtonElement).disabled).toBe(false);
  });
});

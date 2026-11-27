// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Alert } from 'react-native';
import { AuthError } from '@ojoalgasto/shared';
import EliminarCuentaScreen from './EliminarCuentaScreen';

// AN-19: se usa la pantalla real; solo se simulan la red y la sesión.
// capturarSesion y cerrarSesion son las MISMAS funciones en cada render, como en AuthContext.
const { sesionActual, capturarSesion, cerrarSesion, eliminarCuenta } = vi.hoisted(() => {
  const sesionActual = { valor: 1 };
  return {
    sesionActual,
    capturarSesion: () => sesionActual.valor,
    cerrarSesion: vi.fn(async () => {}),
    eliminarCuenta: vi.fn(),
  };
});

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ cerrarSesion, capturarSesion }),
}));
vi.mock('@ojoalgasto/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ojoalgasto/shared')>()),
  eliminarCuenta,
}));

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

const navigation = { goBack: vi.fn() } as never;
const route = { key: 'k', name: 'EliminarCuenta' } as never;

async function pedirBorrado(espera: ReturnType<typeof diferida<unknown>>) {
  eliminarCuenta.mockReturnValueOnce(espera.promesa);
  const vista = render(<EliminarCuentaScreen navigation={navigation} route={route} />);
  fireEvent.change(screen.getByTestId('input-contrasena'), { target: { value: 'secreta123' } });
  fireEvent.change(screen.getByTestId('input-confirmacion'), { target: { value: 'ELIMINAR' } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('confirmar-eliminacion'));
  });
  return vista;
}

let alerta: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sesionActual.valor = 1;
  cerrarSesion.mockClear();
  eliminarCuenta.mockReset();
  alerta = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  alerta.mockRestore();
});

describe('EliminarCuentaScreen: respuestas que llegan con otra sesión (AN-19)', () => {
  it('con la bandera por defecto la pantalla muestra el formulario', () => {
    render(<EliminarCuentaScreen navigation={navigation} route={route} />);
    expect(screen.getByTestId('eliminar-formulario')).toBeTruthy();
    expect(screen.queryByTestId('eliminar-no-disponible')).toBeNull();
  });

  it('si la sesión sigue siendo la misma: cierra la sesión una vez y avisa', async () => {
    const espera = diferida<unknown>();
    await pedirBorrado(espera);
    await act(async () => {
      espera.resolver({ estado: 'eliminada' });
    });
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
    expect(alerta).toHaveBeenCalledTimes(1);
  });

  it('202 pendiente con la misma sesión: cierra la sesión y avisa que todavía no termina', async () => {
    const espera = diferida<unknown>();
    await pedirBorrado(espera);
    await act(async () => {
      espera.resolver({ estado: 'pendiente', operacionId: 'op-1' });
    });
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
    expect(String(alerta.mock.calls[0][1])).toContain('todavía no');
  });

  it('si entró otra cuenta mientras esperaba, la respuesta (204) no cierra la sesión ni avisa', async () => {
    const espera = diferida<unknown>();
    await pedirBorrado(espera);
    sesionActual.valor = 2; // salió A y entró B
    await act(async () => {
      espera.resolver({ estado: 'eliminada' });
    });
    expect(cerrarSesion).not.toHaveBeenCalled();
    expect(alerta).not.toHaveBeenCalled();
  });

  it('lo mismo con 202 pendiente', async () => {
    const espera = diferida<unknown>();
    await pedirBorrado(espera);
    sesionActual.valor = 2;
    await act(async () => {
      espera.resolver({ estado: 'pendiente', operacionId: 'op-1' });
    });
    expect(cerrarSesion).not.toHaveBeenCalled();
    expect(alerta).not.toHaveBeenCalled();
  });

  it('un error tardío de otra sesión no se muestra ni cierra la sesión', async () => {
    const espera = diferida<unknown>();
    await pedirBorrado(espera);
    sesionActual.valor = 2;
    await act(async () => {
      espera.rechazar(new AuthError('caído', 503));
    });
    expect(screen.queryByTestId('error-general')).toBeNull();
    expect(cerrarSesion).not.toHaveBeenCalled();
    expect(alerta).not.toHaveBeenCalled();
  });

  it('si la pantalla se cerró y entró otra cuenta, la respuesta no cierra la sesión nueva', async () => {
    const espera = diferida<unknown>();
    const vista = await pedirBorrado(espera);
    vista.unmount();
    sesionActual.valor = 2;
    await act(async () => {
      espera.resolver({ estado: 'eliminada' });
    });
    expect(cerrarSesion).not.toHaveBeenCalled();
    expect(alerta).not.toHaveBeenCalled();
  });

  it('un error con la misma sesión sí se muestra y no cierra la sesión', async () => {
    const espera = diferida<unknown>();
    await pedirBorrado(espera);
    await act(async () => {
      espera.rechazar(new AuthError('caído', 503));
    });
    expect((await screen.findByTestId('error-general')).textContent).toContain('sigue activa');
    expect(cerrarSesion).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../auth';
import { ErrorDeApi, pedir } from './cliente';
import { eliminarCuenta } from './eliminarCuenta';

vi.mock('./cliente', async (original) => ({
  ...(await original<typeof import('./cliente')>()),
  pedir: vi.fn(),
}));

const pedirMock = vi.mocked(pedir);

describe('eliminarCuenta', () => {
  beforeEach(() => {
  pedirMock.mockReset();
});

  it('llama a DELETE /usuarios/me/ con contraseña y confirmación', async () => {
    pedirMock.mockResolvedValue(undefined);
    await eliminarCuenta({ password: 'Clave123', confirmacion: 'ELIMINAR' });
    expect(pedirMock).toHaveBeenCalledWith('/usuarios/me/', {
      method: 'DELETE',
      body: { password: 'Clave123', confirmacion: 'ELIMINAR' },
    });
  });

  it('204 → eliminada', async () => {
    pedirMock.mockResolvedValue(undefined);
    expect(await eliminarCuenta({ password: 'x', confirmacion: 'ELIMINAR' })).toEqual({ estado: 'eliminada' });
  });

  it('202 → pendiente, con el id de la operación', async () => {
    pedirMock.mockResolvedValue({ estado: 'pendiente', operacion_id: 'op-1' });
    expect(await eliminarCuenta({ password: 'x', confirmacion: 'ELIMINAR' })).toEqual({
      estado: 'pendiente',
      operacionId: 'op-1',
    });
  });

  it('una respuesta que no es 204 ni pendiente no se toma como éxito', async () => {
    pedirMock.mockResolvedValue({ estado: 'otra' });
    await expect(eliminarCuenta({ password: 'x', confirmacion: 'ELIMINAR' })).rejects.toBeInstanceOf(AuthError);
  });

  it('convierte el error del backend en AuthError conservando el status', async () => {
    pedirMock.mockRejectedValue(new ErrorDeApi('no', 403));
    const error = await eliminarCuenta({ password: 'x', confirmacion: 'ELIMINAR' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(403);
  });
});

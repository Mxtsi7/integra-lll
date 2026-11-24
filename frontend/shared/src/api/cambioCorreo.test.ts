import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../auth';
import { ErrorDeApi, pedir } from './cliente';
import { solicitarCambioCorreo } from './cambioCorreo';

vi.mock('./cliente', async (original) => ({
  ...(await original<typeof import('./cliente')>()),
  pedir: vi.fn(),
}));

const pedirMock = vi.mocked(pedir);

describe('solicitarCambioCorreo (S3-AN-02)', () => {
  beforeEach(() => pedirMock.mockReset());

  it('manda el correo nuevo y la contraseña actual, sin espacios sobrantes en el correo', async () => {
    pedirMock.mockResolvedValue({ detail: 'ok' });
    await solicitarCambioCorreo({ correo: '  nuevo@correo.cl ', password: 'Clave123' });
    expect(pedirMock).toHaveBeenCalledWith('/auth/email-verification/request/', {
      method: 'POST',
      body: { email: 'nuevo@correo.cl', password: 'Clave123' },
    });
  });

  it('conserva el código del backend: contraseña incorrecta y correo ocupado se distinguen', async () => {
    pedirMock.mockRejectedValueOnce(new ErrorDeApi('Confirma tu contraseña actual.', 400, undefined, undefined, 'identidad_invalida'));
    const clave = (await solicitarCambioCorreo({ correo: 'a@b.cl', password: 'x' }).catch((e: unknown) => e)) as AuthError;
    expect(clave).toBeInstanceOf(AuthError);
    expect(clave.status).toBe(400);
    expect(clave.codigo).toBe('identidad_invalida');

    pedirMock.mockRejectedValueOnce(new ErrorDeApi('El correo no está disponible.', 400, undefined, undefined, 'correo_no_disponible'));
    const ocupado = (await solicitarCambioCorreo({ correo: 'a@b.cl', password: 'x' }).catch((e: unknown) => e)) as AuthError;
    expect(ocupado.codigo).toBe('correo_no_disponible');
  });

  it('el límite de reenvío (429) queda marcado aunque el cuerpo no traiga código', async () => {
    pedirMock.mockRejectedValueOnce(new ErrorDeApi('Espera.', 429));
    const error = (await solicitarCambioCorreo({ correo: 'a@b.cl', password: 'x' }).catch((e: unknown) => e)) as AuthError;
    expect(error.status).toBe(429);
    expect(error.codigo).toBe('limite_reenvio');
  });

  it('un fallo de red no se convierte en otro error', async () => {
    pedirMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(solicitarCambioCorreo({ correo: 'a@b.cl', password: 'x' })).rejects.toBeInstanceOf(TypeError);
  });
});

/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { confirmarCorreo, getUsuarioActual, haySesionParaReenvio, type Usuario } from '@ojoalgasto/shared';
import { VerificarCorreoConectado } from './VerificarCorreoConectado';

vi.mock('@ojoalgasto/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ojoalgasto/shared')>()),
  confirmarCorreo: vi.fn(),
  getUsuarioActual: vi.fn(),
  haySesionParaReenvio: vi.fn(),
  reenviarVerificacion: vi.fn(),
}));

const { actualizarUsuario, capturarSesion, usuarioEnContexto } = vi.hoisted(() => ({
  actualizarUsuario: vi.fn(),
  capturarSesion: vi.fn(() => 5),
  usuarioEnContexto: { actual: null as unknown },
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioEnContexto.actual, capturarSesion, actualizarUsuario }),
}));

const ANTES: Usuario = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'o', plan: 'premium' };
const confirmarMock = vi.mocked(confirmarCorreo);
const usuarioMock = vi.mocked(getUsuarioActual);
const haySesionMock = vi.mocked(haySesionParaReenvio);

async function abrir() {
  render(
    <MemoryRouter initialEntries={['/verificar-correo?token=abc']}>
      <VerificarCorreoConectado />
    </MemoryRouter>,
  );
  // Una macrotarea para que terminen confirmar y releer antes de mirar la pantalla.
  await act(async () => {
    await new Promise((resolver) => setTimeout(resolver, 0));
  });
}

describe('VerificarCorreoConectado (S3-AN-02)', () => {
  beforeEach(() => {
    confirmarMock.mockReset().mockResolvedValue(undefined);
    // /usuarios/me/ no trae `plan`: la clave no viene, no viene como undefined.
    const leido: Partial<Usuario> = { ...ANTES, correo: 'nuevo@ejemplo.com' };
    delete leido.plan;
    usuarioMock.mockReset().mockResolvedValue(leido as Usuario);
    haySesionMock.mockReset().mockReturnValue(true);
    actualizarUsuario.mockReset();
    capturarSesion.mockClear();
    usuarioEnContexto.actual = ANTES;
  });
  afterEach(cleanup);

  it('con sesión abierta, al confirmar relee el usuario y conserva los campos que /me no trae', async () => {
    await abrir();

    expect(screen.getByText('Tu correo quedó verificado.')).toBeTruthy();
    expect(usuarioMock).toHaveBeenCalledTimes(1);
    expect(actualizarUsuario).toHaveBeenCalledTimes(1);
    const [usuario, sesion] = actualizarUsuario.mock.calls[0];
    expect(usuario.correo).toBe('nuevo@ejemplo.com');
    expect(usuario.plan).toBe('premium'); // no se pierde por una lectura parcial
    expect(sesion).toBe(5); // la sesión de cuando se confirmó
  });

  it('sin sesión en este navegador no lee ningún usuario', async () => {
    haySesionMock.mockReturnValue(false);
    await abrir();

    expect(screen.getByText('Tu correo quedó verificado.')).toBeTruthy();
    expect(usuarioMock).not.toHaveBeenCalled();
    expect(actualizarUsuario).not.toHaveBeenCalled();
  });

  it('si el enlace no sirve no se relee nada', async () => {
    confirmarMock.mockRejectedValue(Object.assign(new Error('x'), { status: 410 }));
    await abrir();

    expect(screen.queryByText('Tu correo quedó verificado.')).toBeNull();
    expect(usuarioMock).not.toHaveBeenCalled();
  });

  it('si la lectura falla, el correo igual aparece como verificado', async () => {
    usuarioMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await abrir();

    expect(screen.getByText('Tu correo quedó verificado.')).toBeTruthy();
    expect(actualizarUsuario).not.toHaveBeenCalled();
  });
});

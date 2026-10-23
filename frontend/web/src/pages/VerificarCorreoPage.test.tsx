// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthError } from '@ojoalgasto/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerificarCorreoPage, type VerificarCorreoProps } from './VerificarCorreoPage';

afterEach(cleanup);

function renderizar(props: VerificarCorreoProps, url = '/verificar-correo?token=abc', estricto = false) {
  const arbol = (
    <MemoryRouter initialEntries={[url]}>
      <VerificarCorreoPage {...props} />
    </MemoryRouter>
  );
  return render(estricto ? <React.StrictMode>{arbol}</React.StrictMode> : arbol);
}

const errorCodigo = (codigo: string, status = 410) => new AuthError('x', status, { codigo });

describe('VerificarCorreoPage', () => {
  it('no marca el correo como verificado hasta que la API responde', async () => {
    let resolver!: () => void;
    const onConfirmar = vi.fn(() => new Promise<void>((r) => (resolver = r)));
    renderizar({ onConfirmar });
    expect(screen.getByText('Verificando tu correo')).toBeTruthy();
    expect(screen.queryByText('Correo verificado')).toBeNull();
    resolver();
    expect(await screen.findByText('Correo verificado')).toBeTruthy();
    expect(onConfirmar).toHaveBeenCalledWith('abc');
  });

  it('confirma el token una sola vez aunque React ejecute el efecto dos veces', async () => {
    const onConfirmar = vi.fn().mockResolvedValue(undefined);
    renderizar({ onConfirmar }, '/verificar-correo?token=abc', true);
    await screen.findByText('Correo verificado');
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it('token vencido muestra una salida clara y no verifica', async () => {
    renderizar({ onConfirmar: () => Promise.reject(errorCodigo('token_expirado')) });
    expect(await screen.findByText('Enlace vencido')).toBeTruthy();
    expect(screen.queryByText('Correo verificado')).toBeNull();
  });

  it('token usado muestra una salida clara', async () => {
    renderizar({ onConfirmar: () => Promise.reject(errorCodigo('token_usado')) });
    expect(await screen.findByText('Enlace ya utilizado')).toBeTruthy();
  });

  it('token inválido muestra una salida clara', async () => {
    renderizar({ onConfirmar: () => Promise.reject(errorCodigo('token_invalido', 400)) });
    expect(await screen.findByText('Enlace inválido')).toBeTruthy();
  });

  it('sin token en la URL no llama al backend', () => {
    const onConfirmar = vi.fn();
    renderizar({ onConfirmar }, '/verificar-correo');
    expect(screen.getByText('Enlace inválido')).toBeTruthy();
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it('error de red permite reintentar', async () => {
    const onConfirmar = vi.fn().mockRejectedValueOnce(new TypeError('fallo')).mockResolvedValueOnce(undefined);
    renderizar({ onConfirmar });
    expect(await screen.findByText(/No pudimos conectar/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Correo verificado')).toBeTruthy();
    expect(onConfirmar).toHaveBeenCalledTimes(2);
  });

  it('con sesión, un enlace vencido permite reenviar', async () => {
    const onReenviar = vi.fn().mockResolvedValue(undefined);
    renderizar({ onConfirmar: () => Promise.reject(errorCodigo('token_expirado')), onReenviar, haySesion: () => true });
    fireEvent.click(await screen.findByRole('button', { name: /Reenviar enlace/ }));
    expect(await screen.findByText(/Te enviamos un enlace nuevo/)).toBeTruthy();
    expect(onReenviar).toHaveBeenCalledTimes(1);
  });

  it('si el reenvío excede el límite, lo explica', async () => {
    const onReenviar = vi.fn().mockRejectedValue(errorCodigo('limite_reenvio', 429));
    renderizar({ onConfirmar: () => Promise.reject(errorCodigo('token_expirado')), onReenviar, haySesion: () => true });
    fireEvent.click(await screen.findByRole('button', { name: /Reenviar enlace/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Espera un minuto/));
  });

  it('sin sesión no ofrece reenviar: lleva a iniciar sesión', async () => {
    renderizar({ onConfirmar: () => Promise.reject(errorCodigo('token_expirado')), onReenviar: vi.fn(), haySesion: () => false });
    expect(await screen.findByText(/Inicia sesión para pedir un enlace nuevo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reenviar enlace/ })).toBeNull();
  });

  it('sin handler no simula éxito', async () => {
    renderizar({});
    expect(await screen.findByText('Esta función todavía no está disponible.')).toBeTruthy();
    expect(screen.queryByText('Correo verificado')).toBeNull();
  });
});

// @vitest-environment jsdom
import React from 'react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthError } from '@ojoalgasto/shared';
import { VerificarCorreoContenido, type VerificarCorreoContenidoProps } from './VerificarCorreoContenido';
import { estadoDesdeError } from './reglasVerificacion';

function montar(cambios: Partial<VerificarCorreoContenidoProps> = {}) {
  const props = {
    token: 'tok-1',
    haySesion: false,
    onIrALogin: vi.fn(),
    onConfirmar: vi.fn().mockResolvedValue(undefined),
    onReenviar: vi.fn().mockResolvedValue(undefined),
    ...cambios,
  };
  render(<VerificarCorreoContenido {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe('estadoDesdeError', () => {
  it('traduce los códigos del contrato MX-28', () => {
    expect(estadoDesdeError(new AuthError('x', 410, { codigo: 'token_expirado' })).tipo).toBe('vencido');
    expect(estadoDesdeError(new AuthError('x', 410, { codigo: 'token_usado' })).tipo).toBe('usado');
    expect(estadoDesdeError(new AuthError('x', 400, { codigo: 'token_invalido' })).tipo).toBe('invalido');
    expect(estadoDesdeError(new AuthError('x', 400, { codigo: 'correo_no_disponible' })).tipo).toBe('correo_no_disponible');
  });

  it('un 503 o un fallo de red se pueden reintentar: no marcan el enlace como malo', () => {
    expect(estadoDesdeError(new AuthError('Servicio caído', 503)).tipo).toBe('error');
    expect(estadoDesdeError(new TypeError('red')).tipo).toBe('error');
  });
});

describe('Verificar correo móvil (AN-12)', () => {
  it('con un enlace bueno confirma el token y muestra el correo verificado', async () => {
    const props = montar();
    expect(await screen.findByTestId('verificacion-verificado')).toBeTruthy();
    expect(props.onConfirmar).toHaveBeenCalledWith('tok-1');
  });

  it('avisa que se verificó solo después de la respuesta del backend', async () => {
    const onVerificado = vi.fn();
    let responder: () => void = () => {};
    const onConfirmar = vi.fn().mockReturnValue(new Promise<void>((resolver) => (responder = resolver)));
    montar({ onConfirmar, onVerificado });
    expect(screen.getByTestId('verificando')).toBeTruthy();
    expect(onVerificado).not.toHaveBeenCalled();
    responder();
    await waitFor(() => expect(onVerificado).toHaveBeenCalledTimes(1));
  });

  it('el token se confirma una sola vez aunque React monte dos veces', async () => {
    const onConfirmar = vi.fn().mockResolvedValue(undefined);
    render(
      <StrictMode>
        <VerificarCorreoContenido token="tok-1" haySesion={false} onIrALogin={vi.fn()} onConfirmar={onConfirmar} />
      </StrictMode>,
    );
    await screen.findByTestId('verificacion-verificado');
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['token_expirado', 'verificacion-vencido'],
    ['token_usado', 'verificacion-usado'],
    ['token_invalido', 'verificacion-invalido'],
  ])('con %s muestra su pantalla y ofrece un enlace nuevo, sin verificar nada', async (codigo, testID) => {
    const onVerificado = vi.fn();
    montar({ haySesion: true, onVerificado, onConfirmar: vi.fn().mockRejectedValue(new AuthError('x', 400, { codigo })) });
    expect(await screen.findByTestId(testID)).toBeTruthy();
    expect(screen.getByTestId('reenviar-enlace')).toBeTruthy();
    expect(onVerificado).not.toHaveBeenCalled();
  });

  it('sin token el enlace no sirve y no llama al backend', () => {
    const props = montar({ token: undefined });
    expect(screen.getByTestId('verificacion-invalido')).toBeTruthy();
    expect(props.onConfirmar).not.toHaveBeenCalled();
  });

  it('si el servidor falla (503) ofrece reintentar y el segundo intento puede funcionar', async () => {
    const onConfirmar = vi.fn().mockRejectedValueOnce(new AuthError('Servicio caído', 503)).mockResolvedValue(undefined);
    montar({ onConfirmar });
    fireEvent.click(await screen.findByTestId('reintentar-verificacion'));
    expect(await screen.findByTestId('verificacion-verificado')).toBeTruthy();
    expect(onConfirmar).toHaveBeenCalledTimes(2);
  });

  it('con sesión, reenviar pide un enlace nuevo y lo confirma en pantalla', async () => {
    const props = montar({ haySesion: true, onConfirmar: vi.fn().mockRejectedValue(new AuthError('x', 410, { codigo: 'token_expirado' })) });
    fireEvent.click(await screen.findByTestId('reenviar-enlace'));
    expect(await screen.findByTestId('reenvio-enviado')).toBeTruthy();
    expect(props.onReenviar).toHaveBeenCalledTimes(1);
  });

  it('sin sesión no ofrece reenviar: ofrece iniciar sesión', async () => {
    const props = montar({ onConfirmar: vi.fn().mockRejectedValue(new AuthError('x', 410, { codigo: 'token_expirado' })) });
    fireEvent.click(await screen.findByTestId('reenviar-iniciar-sesion'));
    expect(props.onIrALogin).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('reenviar-enlace')).toBeNull();
  });

  it('si el reenvío llega al límite, explica la espera', async () => {
    const onReenviar = vi.fn().mockRejectedValue(new AuthError('x', 429, { codigo: 'limite_reenvio' }));
    montar({ haySesion: true, onReenviar, onConfirmar: vi.fn().mockRejectedValue(new AuthError('x', 410, { codigo: 'token_expirado' })) });
    fireEvent.click(await screen.findByTestId('reenviar-enlace'));
    expect((await screen.findByTestId('error-reenvio')).textContent).toContain('demasiados enlaces');
  });

  it('un doble toque en reenviar manda un solo pedido', async () => {
    const props = montar({ haySesion: true, onConfirmar: vi.fn().mockRejectedValue(new AuthError('x', 410, { codigo: 'token_expirado' })) });
    const boton = await screen.findByTestId('reenviar-enlace');
    fireEvent.click(boton);
    fireEvent.click(boton);
    await screen.findByTestId('reenvio-enviado');
    expect(props.onReenviar).toHaveBeenCalledTimes(1);
  });
});

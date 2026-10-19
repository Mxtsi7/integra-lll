import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConectarCorreo } from './ConectarCorreo';

const URL_GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';

describe('ConectarCorreo', () => {
  it('los botones quedan deshabilitados hasta dar el consentimiento', () => {
    render(<ConectarCorreo onIniciar={vi.fn()} redirigir={vi.fn()} />);
    expect((screen.getByRole('button', { name: /Conectar Gmail/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: /Conectar Gmail/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('pide la URL del proveedor elegido y redirige', async () => {
    const onIniciar = vi.fn().mockResolvedValue(URL_GOOGLE);
    const redirigir = vi.fn();
    render(<ConectarCorreo onIniciar={onIniciar} redirigir={redirigir} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Conectar Gmail/ }));
    await waitFor(() => expect(redirigir).toHaveBeenCalledWith(URL_GOOGLE));
    expect(onIniciar).toHaveBeenCalledWith('gmail');
  });

  it('NO redirige si la URL no es del proveedor pedido', async () => {
    const redirigir = vi.fn();
    render(<ConectarCorreo onIniciar={() => Promise.resolve('https://evil.com/phishing')} redirigir={redirigir} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Conectar Outlook/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(redirigir).not.toHaveBeenCalled();
  });

  it('si el backend falla, muestra error y no redirige', async () => {
    const redirigir = vi.fn();
    render(<ConectarCorreo onIniciar={() => Promise.reject(new Error('x'))} redirigir={redirigir} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Conectar Gmail/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(redirigir).not.toHaveBeenCalled();
  });
});

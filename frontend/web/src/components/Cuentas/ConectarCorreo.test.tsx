// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConectarCorreo } from './ConectarCorreo';

afterEach(cleanup);
const URL_GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';

describe('ConectarCorreo', () => {
  it('los botones quedan deshabilitados hasta dar el consentimiento', () => {
    render(<ConectarCorreo onIniciar={vi.fn()} redirigir={vi.fn()} />);
    expect((screen.getByRole('button', { name: /Conectar Gmail/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Gmail/ }));
    expect((screen.getByRole('button', { name: /Conectar Gmail/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Conectar Outlook/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pide la URL del proveedor elegido y redirige', async () => {
    const onIniciar = vi.fn().mockResolvedValue(URL_GOOGLE);
    const redirigir = vi.fn();
    render(<ConectarCorreo onIniciar={onIniciar} redirigir={redirigir} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Gmail/ }));
    fireEvent.click(screen.getByRole('button', { name: /Conectar Gmail/ }));
    await waitFor(() => expect(redirigir).toHaveBeenCalledWith(URL_GOOGLE));
    expect(onIniciar).toHaveBeenCalledWith('gmail', { consentimiento: true, version_texto: 'correo-v1' });
  });

  it('NO redirige si la URL no es del proveedor pedido', async () => {
    const redirigir = vi.fn();
    render(<ConectarCorreo onIniciar={() => Promise.resolve('https://evil.com/phishing')} redirigir={redirigir} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Outlook/ }));
    fireEvent.click(screen.getByRole('button', { name: /Conectar Outlook/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(redirigir).not.toHaveBeenCalled();
  });

  it('si el backend falla, muestra error y no redirige', async () => {
    const redirigir = vi.fn();
    render(<ConectarCorreo onIniciar={() => Promise.reject(new Error('x'))} redirigir={redirigir} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Gmail/ }));
    fireEvent.click(screen.getByRole('button', { name: /Conectar Gmail/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(redirigir).not.toHaveBeenCalled();
  });

  it('bloquea ambos consentimientos mientras inicia la autorización', async () => {
    let terminar!: (url: string) => void;
    const redirigir = vi.fn();
    render(<ConectarCorreo onIniciar={() => new Promise((resolve) => { terminar = resolve; })} redirigir={redirigir} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Gmail/ }));
    fireEvent.click(screen.getByRole('button', { name: /Conectar Gmail/ }));
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect((checkbox as HTMLInputElement).disabled).toBe(true);
    }
    terminar(URL_GOOGLE);
    await waitFor(() => expect(redirigir).toHaveBeenCalledWith(URL_GOOGLE));
  });
});

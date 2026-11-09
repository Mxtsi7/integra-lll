// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CuentaConectada } from '@ojoalgasto/shared';
import { AutorizacionCorreoContenido } from './AutorizacionCorreoContenido';
import { CuentasContenido } from './CuentasContenido';
import { MENSAJES_AUTORIZACION } from './useAutorizacionCorreo';

function crearCuenta(id: string, cambios: Partial<CuentaConectada> = {}): CuentaConectada {
  return {
    id,
    proveedor: 'gmail',
    proveedor_legible: 'Gmail',
    cuenta_externa: `${id}@correo.cl`,
    estado: 'conectada',
    estado_legible: 'Conectada',
    detalle_del_estado: '',
    necesita_reautorizacion: false,
    token_expira_en: null,
    ultima_sincronizacion: '2026-11-01T10:00:00Z',
    creado_en: '2026-10-01T10:00:00Z',
    actualizado_en: '2026-11-01T10:00:00Z',
    ...cambios,
  };
}

function crearApiCuentas(cuentas: CuentaConectada[] = []) {
  return {
    getCuentasConectadas: vi.fn().mockResolvedValue(cuentas),
    desconectarCuenta: vi.fn().mockResolvedValue(crearCuenta('ana', { estado: 'desconectada', estado_legible: 'Desconectada' })),
  };
}

afterEach(() => {
  cleanup();
});

describe('Cuentas conectadas móvil (AN-06)', () => {
  it('desconectar pide confirmar y luego muestra el estado que devolvió el backend', async () => {
    const api = crearApiCuentas([crearCuenta('ana')]);
    render(<CuentasContenido onConectar={vi.fn()} api={api} />);
    fireEvent.click(await screen.findByTestId('desconectar-ana'));
    expect(api.desconectarCuenta).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirmar-desconexion-ana'));
    await waitFor(() => expect(screen.getByTestId('cuenta-estado-ana').textContent).toBe('Desconectada'));
    expect(api.desconectarCuenta).toHaveBeenCalledWith('ana');
    expect(screen.queryByTestId('desconectar-ana')).toBeNull();
  });

  it('cancelar la confirmación no llama al backend', async () => {
    const api = crearApiCuentas([crearCuenta('ana')]);
    render(<CuentasContenido onConectar={vi.fn()} api={api} />);
    fireEvent.click(await screen.findByTestId('desconectar-ana'));
    fireEvent.click(screen.getByTestId('cancelar-desconexion-ana'));
    expect(api.desconectarCuenta).not.toHaveBeenCalled();
    expect(screen.getByTestId('desconectar-ana')).toBeTruthy();
  });

  it('si falla desconectar avisa y la cuenta sigue conectada', async () => {
    const api = { ...crearApiCuentas([crearCuenta('ana')]), desconectarCuenta: vi.fn().mockRejectedValue(new Error('500')) };
    render(<CuentasContenido onConectar={vi.fn()} api={api} />);
    fireEvent.click(await screen.findByTestId('desconectar-ana'));
    fireEvent.click(screen.getByTestId('confirmar-desconexion-ana'));
    expect(await screen.findByTestId('error-cuentas')).toBeTruthy();
    expect(screen.getByTestId('cuenta-estado-ana').textContent).toBe('Conectada');
  });

  it('muestra cada cuenta con su estado', async () => {
    const api = crearApiCuentas([crearCuenta('ana'), crearCuenta('beto')]);
    render(<CuentasContenido onConectar={vi.fn()} api={api} />);
    expect(await screen.findByTestId('cuenta-ana')).toBeTruthy();
    expect(screen.getByText('beto@correo.cl')).toBeTruthy();
    expect(screen.getByTestId('cuenta-estado-ana').textContent).toBe('Conectada');
    expect(screen.queryByTestId('reconectar-ana')).toBeNull();
  });

  it('una cuenta que necesita reautorización ofrece volver a autorizar', async () => {
    const onConectar = vi.fn();
    const cuenta = crearCuenta('ana', {
      estado: 'requiere_reautorizacion',
      estado_legible: 'Requiere reautorización',
      necesita_reautorizacion: true,
      detalle_del_estado: 'El proveedor rechazó el token.',
    });
    render(<CuentasContenido onConectar={onConectar} api={crearApiCuentas([cuenta])} />);
    expect(await screen.findByText('El proveedor rechazó el token.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reconectar-ana'));
    expect(onConectar).toHaveBeenCalledTimes(1);
  });

  it('sin cuentas muestra el estado vacío con la acción de conectar', async () => {
    const onConectar = vi.fn();
    render(<CuentasContenido onConectar={onConectar} api={crearApiCuentas([])} />);
    expect(await screen.findByText('Aún no conectas ninguna cuenta')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Conectar correo' }));
    expect(onConectar).toHaveBeenCalledTimes(1);
  });

  it('si falla la carga muestra error y reintentar vuelve a pedir', async () => {
    const getCuentasConectadas = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue([crearCuenta('ana')]);
    render(<CuentasContenido onConectar={vi.fn()} api={{ ...crearApiCuentas(), getCuentasConectadas }} />);
    fireEvent.click(await screen.findByRole('button', { name: /reintentar/i }));
    expect(await screen.findByTestId('cuenta-ana')).toBeTruthy();
  });

  it('al volver a la pantalla se recarga la lista', async () => {
    let recargarDesdeFoco: () => void = () => {};
    const alVolver = (recargar: () => void) => {
      recargarDesdeFoco = recargar;
      return () => {};
    };
    const getCuentasConectadas = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([crearCuenta('ana')]);
    render(<CuentasContenido onConectar={vi.fn()} alVolverAPantalla={alVolver} api={{ ...crearApiCuentas(), getCuentasConectadas }} />);
    await screen.findByText('Aún no conectas ninguna cuenta');
    recargarDesdeFoco();
    expect(await screen.findByTestId('cuenta-ana')).toBeTruthy();
  });
});

const URL_GMAIL = 'https://accounts.google.com/o/oauth2/v2/auth?state=abc';

function crearApiAutorizacion(url = URL_GMAIL) {
  return {
    iniciarAutorizacionCorreo: vi.fn().mockResolvedValue({ url_autorizacion: url, estado_oauth: 'abc', expira_en: '2026-11-09T10:10:00Z' }),
  };
}

describe('Autorización de correo móvil (AN-09)', () => {
  it('abre la página del proveedor y avisa que falta terminar en el navegador', async () => {
    const abrirUrl = vi.fn().mockResolvedValue(undefined);
    const api = crearApiAutorizacion();
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={api} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    expect(await screen.findByTestId('autorizacion-esperando')).toBeTruthy();
    expect(api.iniciarAutorizacionCorreo).toHaveBeenCalledWith('gmail');
    expect(abrirUrl).toHaveBeenCalledWith(URL_GMAIL);
  });

  it('no abre una URL que no sea del proveedor', async () => {
    const abrirUrl = vi.fn();
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={crearApiAutorizacion('https://sitio-falso.com/login')} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    expect((await screen.findByTestId('error-autorizacion')).textContent).toBe(MENSAJES_AUTORIZACION.urlInsegura);
    expect(abrirUrl).not.toHaveBeenCalled();
  });

  it('la URL de Gmail no sirve para Outlook', async () => {
    const abrirUrl = vi.fn();
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={crearApiAutorizacion(URL_GMAIL)} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-outlook'));
    expect(await screen.findByTestId('error-autorizacion')).toBeTruthy();
    expect(abrirUrl).not.toHaveBeenCalled();
  });

  it('si el backend falla muestra el error y no abre nada', async () => {
    const abrirUrl = vi.fn();
    const api = { iniciarAutorizacionCorreo: vi.fn().mockRejectedValue(new Error('503')) };
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={api} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    expect((await screen.findByTestId('error-autorizacion')).textContent).toBe(MENSAJES_AUTORIZACION.fallaInicio);
    expect(abrirUrl).not.toHaveBeenCalled();
  });

  it('si no se puede abrir el navegador lo avisa', async () => {
    const abrirUrl = vi.fn().mockRejectedValue(new Error('sin navegador'));
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={crearApiAutorizacion()} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    expect((await screen.findByTestId('error-autorizacion')).textContent).toBe(MENSAJES_AUTORIZACION.fallaNavegador);
  });

  it('un doble toque inicia una sola autorización', async () => {
    const api = crearApiAutorizacion();
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={api} abrirUrl={vi.fn().mockResolvedValue(undefined)} />);
    const boton = screen.getByTestId('conectar-gmail');
    fireEvent.click(boton);
    fireEvent.click(boton);
    await waitFor(() => expect(screen.getByTestId('autorizacion-esperando')).toBeTruthy());
    expect(api.iniciarAutorizacionCorreo).toHaveBeenCalledTimes(1);
  });

  it('desde el aviso se puede ir a ver las cuentas conectadas', async () => {
    const onVerCuentas = vi.fn();
    render(<AutorizacionCorreoContenido onVerCuentas={onVerCuentas} api={crearApiAutorizacion()} abrirUrl={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    fireEvent.click(await screen.findByTestId('ver-cuentas'));
    expect(onVerCuentas).toHaveBeenCalledTimes(1);
  });
});

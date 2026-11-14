// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { CuentaConectada } from '@ojoalgasto/shared';
import { AutorizacionCorreoContenido } from './AutorizacionCorreoContenido';
import { CuentasContenido } from './CuentasContenido';
import { MENSAJES_AUTORIZACION } from './useAutorizacionCorreo';
import { MENSAJE_ERROR_DESCONEXION, useCuentas } from './useCuentas';

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
    const desconectada = crearCuenta('ana', { estado: 'desconectada', estado_legible: 'Desconectada' });
    const api = {
      ...crearApiCuentas(),
      // Antes del DELETE el backend devuelve la cuenta conectada; después, ya desconectada.
      getCuentasConectadas: vi.fn().mockResolvedValueOnce([crearCuenta('ana')]).mockResolvedValue([desconectada]),
    };
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
    // Recargar cambia el estado fuera de un evento de usuario: se envuelve en act.
    act(() => recargarDesdeFoco());
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


/** Una promesa que se resuelve o rechaza a mano, para probar en qué orden llegan las respuestas. */
function crearDiferido<T>() {
  let resolver: (valor: T) => void = () => {};
  let rechazar: (error: unknown) => void = () => {};
  const promesa = new Promise<T>((alResolver, alRechazar) => {
    resolver = alResolver;
    rechazar = alRechazar;
  });
  return { promesa, resolver, rechazar };
}

describe('Desconectar mientras se recarga la lista (regresión de la revisión de #156)', () => {
  const conectada = crearCuenta('ana');
  const desconectada = crearCuenta('ana', { estado: 'desconectada', estado_legible: 'Desconectada' });

  it('una recarga que llega con la cuenta aún conectada no deja la fila obsoleta ni la marca pendiente', async () => {
    const recargaVieja = crearDiferido<CuentaConectada[]>();
    const desconexion = crearDiferido<CuentaConectada>();
    const getCuentasConectadas = vi
      .fn()
      .mockResolvedValueOnce([conectada]) // carga inicial
      .mockReturnValueOnce(recargaVieja.promesa) // recarga al volver, durante el DELETE
      .mockResolvedValue([desconectada]); // reconciliación final: lo que confirma el backend
    const api = { getCuentasConectadas, desconectarCuenta: vi.fn().mockReturnValue(desconexion.promesa) };

    const { result } = renderHook(() => useCuentas(api));
    await waitFor(() => expect(result.current.estado.tipo).toBe('listo'));

    let desconectando: Promise<void> = Promise.resolve();
    act(() => {
      desconectando = result.current.desconectar('ana');
    });
    act(() => {
      void result.current.cargar();
    });

    await act(async () => {
      recargaVieja.resolver([conectada]); // el backend aún no había procesado el DELETE
    });
    await act(async () => {
      desconexion.resolver(desconectada);
      await desconectando;
    });

    await waitFor(() => {
      const { estado } = result.current;
      expect(estado.tipo === 'listo' && estado.datos[0].estado).toBe('desconectada');
    });
    expect(result.current.idsDesconectando).toEqual([]);
  });

  it('una recarga vieja que llega DESPUÉS del DELETE no pisa el estado desconectado', async () => {
    const recargaVieja = crearDiferido<CuentaConectada[]>();
    const getCuentasConectadas = vi
      .fn()
      .mockResolvedValueOnce([conectada])
      .mockReturnValueOnce(recargaVieja.promesa)
      .mockResolvedValue([desconectada]);
    const api = { getCuentasConectadas, desconectarCuenta: vi.fn().mockResolvedValue(desconectada) };

    const { result } = renderHook(() => useCuentas(api));
    await waitFor(() => expect(result.current.estado.tipo).toBe('listo'));

    act(() => {
      void result.current.cargar();
    });
    await act(async () => {
      await result.current.desconectar('ana');
    });
    await act(async () => {
      recargaVieja.resolver([conectada]); // llega tarde, con datos de antes del DELETE
    });

    await waitFor(() => {
      const { estado } = result.current;
      expect(estado.tipo === 'listo' && estado.datos[0].estado).toBe('desconectada');
    });
    expect(result.current.idsDesconectando).toEqual([]);
  });

  it('si el DELETE falla mientras se recarga: avisa, libera la marca y deja lo que confirma el backend', async () => {
    const recarga = crearDiferido<CuentaConectada[]>();
    const desconexion = crearDiferido<CuentaConectada>();
    const getCuentasConectadas = vi
      .fn()
      .mockResolvedValueOnce([conectada])
      .mockReturnValueOnce(recarga.promesa)
      .mockResolvedValue([conectada]);
    const api = { getCuentasConectadas, desconectarCuenta: vi.fn().mockReturnValue(desconexion.promesa) };

    const { result } = renderHook(() => useCuentas(api));
    await waitFor(() => expect(result.current.estado.tipo).toBe('listo'));

    let desconectando: Promise<void> = Promise.resolve();
    act(() => {
      desconectando = result.current.desconectar('ana');
    });
    act(() => {
      void result.current.cargar();
    });
    await act(async () => {
      recarga.resolver([conectada]);
    });
    await act(async () => {
      desconexion.rechazar(new Error('500'));
      await desconectando;
    });

    await waitFor(() => expect(result.current.mensajeError).toBe(MENSAJE_ERROR_DESCONEXION));
    expect(result.current.idsDesconectando).toEqual([]);
    const { estado } = result.current;
    expect(estado.tipo === 'listo' && estado.datos[0].estado).toBe('conectada');
  });

  it('un DELETE que termina cuando la pantalla ya se cerró no falla ni actualiza nada', async () => {
    const desconexion = crearDiferido<CuentaConectada>();
    const api = { getCuentasConectadas: vi.fn().mockResolvedValue([conectada]), desconectarCuenta: vi.fn().mockReturnValue(desconexion.promesa) };

    const { result, unmount } = renderHook(() => useCuentas(api));
    await waitFor(() => expect(result.current.estado.tipo).toBe('listo'));
    let desconectando: Promise<void> = Promise.resolve();
    act(() => {
      desconectando = result.current.desconectar('ana');
    });
    unmount();
    desconexion.resolver(desconectada);
    await desconectando;
    expect(api.getCuentasConectadas).toHaveBeenCalledTimes(1); // no pide la lista de una pantalla cerrada
  });
});

describe('Autorización abandonada (regresión de la revisión de #156)', () => {
  it('si la persona sale de la pantalla antes de que llegue la respuesta, no se abre el navegador', async () => {
    const respuesta = crearDiferido<{ url_autorizacion: string; estado_oauth: string; expira_en: string }>();
    const abrirUrl = vi.fn().mockResolvedValue(undefined);
    const api = { iniciarAutorizacionCorreo: vi.fn().mockReturnValue(respuesta.promesa) };

    const { unmount } = render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={api} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    unmount();
    respuesta.resolver({ url_autorizacion: URL_GMAIL, estado_oauth: 'abc', expira_en: '2026-11-10T10:10:00Z' });
    await Promise.resolve();
    await Promise.resolve();

    expect(abrirUrl).not.toHaveBeenCalled();
  });

  it('con la pantalla abierta, abre el navegador exactamente una vez', async () => {
    const abrirUrl = vi.fn().mockResolvedValue(undefined);
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={crearApiAutorizacion()} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    await screen.findByTestId('autorizacion-esperando');
    expect(abrirUrl).toHaveBeenCalledTimes(1);
  });

  it('si el intento falla se puede reintentar y el segundo abre el navegador', async () => {
    const abrirUrl = vi.fn().mockResolvedValue(undefined);
    const iniciarAutorizacionCorreo = vi
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue({ url_autorizacion: URL_GMAIL, estado_oauth: 'abc', expira_en: '2026-11-10T10:10:00Z' });
    render(<AutorizacionCorreoContenido onVerCuentas={vi.fn()} api={{ iniciarAutorizacionCorreo }} abrirUrl={abrirUrl} />);
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    await screen.findByTestId('error-autorizacion');
    fireEvent.click(screen.getByTestId('conectar-gmail'));
    await screen.findByTestId('autorizacion-esperando');
    expect(abrirUrl).toHaveBeenCalledTimes(1);
  });
});

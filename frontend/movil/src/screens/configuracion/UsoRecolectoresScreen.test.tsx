import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsoRecolectoresScreen from './UsoRecolectoresScreen';

const { moduloNativo, appState } = vi.hoisted(() => ({
  moduloNativo: {
    tienePermiso: vi.fn(async () => false),
    abrirAjustes: vi.fn(async () => {}),
    leerEstadisticas: vi.fn(async () => []),
    leerTramos: vi.fn(async () => [{ paquete: 'com.ejemplo.app', inicioMs: 2000, finMs: 3000 }]),
  },
  appState: { addEventListener: vi.fn() },
}));

vi.mock('@ojoalgasto/shared', () => ({
  obtenerAccessToken: () => 'token-de-prueba',
  sesionDelToken: () => 'sesion-de-prueba',
}));

const colaPantalla = { fase: 'activo', pendientes: [], ultimoEnvio: undefined };
const controles = vi.hoisted(() => ({ aceptar: vi.fn(), ciclo: vi.fn(), pausar: vi.fn(), revocar: vi.fn(), estado: vi.fn() }));
vi.mock('../../services/usoAndroidSincronizacion', () => ({
  aceptarUsoAndroid: controles.aceptar, cicloUsoAndroid: controles.ciclo, pausarUsoAndroid: controles.pausar,
  revocarUsoAndroid: controles.revocar, estadoUsoAndroid: controles.estado,
}));

vi.mock('../../services/usoAndroidNativo', () => ({ usoAndroidNativo: moduloNativo }));
vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-native')>()),
  AppState: appState,
}));

describe('pantalla de acceso de uso Android', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controles.estado.mockResolvedValue({ seleccion: null, estado: null });
    appState.addEventListener.mockReturnValue({ remove: vi.fn() });
  });
  afterEach(() => vi.restoreAllMocks());

  it('vuelve a verificar al regresar de Ajustes y no captura por abrirlo', async () => {
    let cambioEstado: ((estado: string) => void) | undefined;
    appState.addEventListener.mockImplementation((_evento, listener) => {
      cambioEstado = listener;
      return { remove: vi.fn() };
    });
    moduloNativo.tienePermiso.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<UsoRecolectoresScreen />);

    expect(await screen.findByText('El permiso de acceso al uso está desactivado.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('abrir-ajustes-uso'));
    await waitFor(() => expect(moduloNativo.abrirAjustes).toHaveBeenCalledOnce());
    expect(moduloNativo.leerEstadisticas).not.toHaveBeenCalled();

    await act(async () => cambioEstado?.('active'));
    expect(await screen.findByText('El permiso de Android está concedido.')).toBeTruthy();
    expect(moduloNativo.leerEstadisticas).not.toHaveBeenCalled();
  });
  it('autoriza y sincroniza con controles separados de pausar y retirar', async () => {
    appState.addEventListener.mockReturnValue({ remove: vi.fn() });
    moduloNativo.tienePermiso.mockResolvedValue(true);
    let autorizado = false;
    controles.estado.mockImplementation(async () => ({
      seleccion: autorizado ? { paquete: 'com.ejemplo.app' } : null,
      estado: autorizado ? colaPantalla : null,
    }));
    controles.aceptar.mockImplementation(async () => { autorizado = true; });
    controles.revocar.mockImplementation(async () => { autorizado = false; });
    render(<UsoRecolectoresScreen />);
    await screen.findByText('El permiso de Android está concedido.');
    fireEvent.change(screen.getByLabelText('Paquete autorizado para consulta'), { target: { value: 'com.ejemplo.app' } });
    expect(controles.aceptar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Acepto capturar y sincronizar el uso' }));
    await screen.findByText('Paquete autorizado: com.ejemplo.app');
    expect(controles.aceptar).toHaveBeenCalledWith('com.ejemplo.app');
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }));
    await waitFor(() => expect(controles.ciclo).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Pausar captura' }));
    await waitFor(() => expect(controles.pausar).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Retirar autorización' }));
    await waitFor(() => expect(controles.revocar).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Acepto capturar y sincronizar el uso' });
  });
});

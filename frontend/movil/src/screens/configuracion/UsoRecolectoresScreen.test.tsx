import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../services/usoAndroidNativo', () => ({ usoAndroidNativo: moduloNativo }));
vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-native')>()),
  AppState: appState,
}));

describe('pantalla de acceso de uso Android', () => {
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
  it('lee solo tras la aceptación y descarta un resultado tardío al retirarla', async () => {
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(1000);
    appState.addEventListener.mockReturnValue({ remove: vi.fn() });
    moduloNativo.tienePermiso.mockResolvedValue(true);
    let resolverTramos!: (tramos: { paquete: string; inicioMs: number; finMs: number }[]) => void;
    moduloNativo.leerTramos.mockImplementationOnce(() => new Promise(resolve => { resolverTramos = resolve; }));

    render(<UsoRecolectoresScreen />);
    await screen.findByText('El permiso de Android está concedido.');
    fireEvent.change(screen.getByLabelText('Paquete autorizado para consulta'), {
      target: { value: 'com.ejemplo.app' },
    });
    expect(moduloNativo.leerTramos).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Acepto autorizar la consulta local' }));
    expect(moduloNativo.leerTramos).not.toHaveBeenCalled();
    reloj.mockReturnValue(4000);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar intervalos' }));
    await waitFor(() => expect(moduloNativo.leerTramos).toHaveBeenCalledWith(1000, 4000, ['com.ejemplo.app'], true));
    fireEvent.click(screen.getByRole('button', { name: 'Retirar autorización' }));
    await act(async () => resolverTramos([{ paquete: 'com.ejemplo.app', inicioMs: 2000, finMs: 3000 }]));
    expect(screen.queryByText(/Intervalos encontrados: 1\./)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Consultar intervalos' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Acepto autorizar la consulta local' }));
    reloj.mockReturnValue(8000);
    moduloNativo.leerTramos.mockResolvedValueOnce([{ paquete: 'com.ejemplo.app', inicioMs: 5000, finMs: 7000 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar intervalos' }));
    expect(await screen.findByText(/Intervalos encontrados: 1\.[\s\S]*0,03333 min/)).toBeTruthy();
    expect(moduloNativo.leerTramos).toHaveBeenLastCalledWith(4000, 8000, ['com.ejemplo.app'], true);
  });

});

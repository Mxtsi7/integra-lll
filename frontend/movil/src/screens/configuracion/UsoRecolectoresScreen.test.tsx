import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UsoRecolectoresScreen from './UsoRecolectoresScreen';

const { moduloNativo, appState } = vi.hoisted(() => ({
  moduloNativo: {
    tienePermiso: vi.fn(async () => false),
    abrirAjustes: vi.fn(async () => {}),
    leerEstadisticas: vi.fn(async () => []),
  },
  appState: { addEventListener: vi.fn() },
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
});

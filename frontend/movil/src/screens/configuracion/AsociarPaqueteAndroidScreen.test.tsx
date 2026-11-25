import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsociarPaqueteAndroidScreen from './AsociarPaqueteAndroidScreen';

const { listar, asociar, quitar, getSuscripciones } = vi.hoisted(() => ({
  listar: vi.fn(async (): Promise<{ suscripcionId: string; paquete: string }[]> => []),
  asociar: vi.fn(async (_suscripcionId: string, _paquete: string, _anterior?: { suscripcionId: string; paquete: string }) => {}),
  quitar: vi.fn(async (_paquete: string) => {}),
  getSuscripciones: vi.fn(async () => [{
    id: 'suscripcion-propia', nombre: 'Música', monto: 10, moneda: 'CLP',
    frecuencia: 'mensual' as const, fecha_proximo_cobro: '2026-11-01', categoria: 'ocio', estado: 'activo' as const,
  }]),
}));

vi.mock('@ojoalgasto/shared', () => ({ getSuscripciones }));
vi.mock('../../services/usoAndroidAsociacion', () => ({
  controlAsociacionPaquetes: { listar, asociar, quitar },
}));

describe('pantalla de asociación manual Android', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('asocia el paquete escrito a la suscripción seleccionada', async () => {
    render(<AsociarPaqueteAndroidScreen />);

    fireEvent.click(await screen.findByTestId('seleccionar-suscripcion-suscripcion-propia'));
    fireEvent.change(await screen.findByTestId('entrada-paquete-android'), { target: { value: 'com.ejemplo.musica' } });
    fireEvent.click(screen.getByTestId('guardar-asociacion-paquete'));

    await waitFor(() => expect(asociar).toHaveBeenCalledWith('suscripcion-propia', 'com.ejemplo.musica'));
  });
  it('carga la asociación elegida y confirma su corrección explícitamente', async () => {
    const anterior = { suscripcionId: 'suscripcion-propia', paquete: 'com.ejemplo.app' };
    listar.mockResolvedValueOnce([anterior]);
    render(<AsociarPaqueteAndroidScreen />);

    fireEvent.click(await screen.findByTestId('corregir-asociacion-com.ejemplo.app'));
    fireEvent.change(screen.getByTestId('entrada-paquete-android'), { target: { value: 'com.ejemplo.nueva' } });
    fireEvent.click(screen.getByText('Confirmar corrección'));

    await waitFor(() => expect(asociar).toHaveBeenCalledWith('suscripcion-propia', 'com.ejemplo.nueva', anterior));
  });
});

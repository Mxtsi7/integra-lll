// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getPreferenciasAlertas, type PreferenciasAlertas } from '@ojoalgasto/shared';
import PreferenciasNotificacionScreen from './PreferenciasNotificacionScreen';

vi.mock('@ojoalgasto/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ojoalgasto/shared')>();
  return {
    ...real,
    getPreferenciasAlertas: vi.fn(),
    guardarPreferenciasAlertas: vi.fn(),
  };
});

const getMock = vi.mocked(getPreferenciasAlertas);

const PREFERENCIAS_MOCK: PreferenciasAlertas = {
  por_email: true,
  por_push: true,
  en_la_app: true,
  avisar_proximo_cobro: true,
  avisar_fin_prueba: true,
  avisar_alza_tarifa: true,
  avisar_doble_cobro: true,
  avisar_presupuesto_excedido: true,
  dias_anticipacion: 3,
  canales_disponibles: ['email', 'push', 'in_app'],
  canales_elegidos: ['email', 'push', 'in_app'],
  actualizado_en: '2026-11-20T10:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PreferenciasNotificacionScreen (SE-32)', () => {
  it('renderiza la pantalla de preferencias de notificación y navega hacia atrás', async () => {
    getMock.mockResolvedValueOnce(PREFERENCIAS_MOCK);
    const mockGoBack = vi.fn();
    const navigationMock = { goBack: mockGoBack } as any;
    const routeMock = { key: 'test-key', name: 'PreferenciasNotificacion' } as any;

    render(<PreferenciasNotificacionScreen navigation={navigationMock} route={routeMock} />);

    expect(screen.getByTestId('screen-preferencias-notificacion')).toBeDefined();
    expect(screen.getByText('Preferencias de notificación')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
    });

    const btnVolver = screen.getByTestId('go-back');
    expect(btnVolver.textContent).toBe('Volver a Configuración');
    fireEvent.click(btnVolver);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

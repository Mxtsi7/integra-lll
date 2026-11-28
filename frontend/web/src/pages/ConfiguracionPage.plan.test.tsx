// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPermisosPlan, type PermisosPlan } from '@ojoalgasto/shared';
import { ConfiguracionPage } from './ConfiguracionPage';

vi.mock('@ojoalgasto/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ojoalgasto/shared')>();
  return {
    ...real,
    getPermisosPlan: vi.fn(),
  };
});

const getPermisosPlanMock = vi.mocked(getPermisosPlan);

vi.mock('../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('../components/Configuracion/PreferenciasAvisos', () => ({ PreferenciasAvisos: () => null }));
vi.mock('../components/Configuracion/RecolectoresDeUso', () => ({ RecolectoresDeUso: () => null }));
vi.mock('../components/Perfil/EliminarCuenta', () => ({ EliminarCuenta: () => null }));
const capturarSesionMock = vi.fn(() => 1);
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ cerrarSesionLocal: () => true, capturarSesion: capturarSesionMock }),
}));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ exito: vi.fn() }) }));

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

afterEach(() => {
  cleanup();
});

describe('Sección Plan en Ajustes (SE-02 / MX-08 / MX-09)', () => {
  beforeEach(() => {
    getPermisosPlanMock.mockReset();
  });

  it('muestra estado de comprobación mientras consulta el plan en el servidor sin texto fijo', async () => {
    const deferred = diferida<PermisosPlan>();
    getPermisosPlanMock.mockReturnValue(deferred.promesa);

    render(
      <MemoryRouter>
        <ConfiguracionPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Comprobando plan…')).toBeInTheDocument();
    expect(
      screen.getByText('Consultando el estado de tu suscripción en el servidor.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Plan Gratuito')).not.toBeInTheDocument();
    expect(screen.queryByText('Plan Premium')).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolver({
        plan: 'free',
        features: { asistente_financiero: false, recomendaciones_automaticas: false },
      });
    });

    expect(screen.getByText('Plan Gratuito')).toBeInTheDocument();
  });

  it('muestra error y opción de reintentar si el servidor falla, sin conceder Premium por omisión', async () => {
    getPermisosPlanMock.mockRejectedValue(new Error('Fallo de conexión'));

    render(
      <MemoryRouter>
        <ConfiguracionPage />
      </MemoryRouter>,
    );

    const reintentarBtn = await screen.findByRole('button', { name: /reintentar/i });
    expect(reintentarBtn).toBeInTheDocument();
    expect(screen.queryByText('Plan Premium')).not.toBeInTheDocument();

    getPermisosPlanMock.mockResolvedValueOnce({
      plan: 'free',
      features: { asistente_financiero: false, recomendaciones_automaticas: false },
    });

    await act(async () => {
      fireEvent.click(reintentarBtn);
    });

    expect(getPermisosPlanMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Plan Gratuito')).toBeInTheDocument();
  });

  it('muestra Plan Gratuito, detalle y enlace para mejorar a Premium cuando el usuario es Free', async () => {
    getPermisosPlanMock.mockResolvedValue({
      plan: 'free',
      features: { asistente_financiero: false, recomendaciones_automaticas: false },
    });

    render(
      <MemoryRouter>
        <ConfiguracionPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Plan Gratuito')).toBeInTheDocument();
    expect(
      screen.getByText('Alertas de cobro y de prueba gratis incluidas.'),
    ).toBeInTheDocument();
    const mejorarLink = screen.getByRole('link', { name: 'Mejorar a Premium' });
    expect(mejorarLink).toBeInTheDocument();
    expect(mejorarLink).toHaveAttribute('href', '/perfil');
  });

  it('muestra Plan Premium y beneficios activos sin botón de upgrade cuando el usuario es Premium', async () => {
    getPermisosPlanMock.mockResolvedValue({
      plan: 'premium',
      features: { asistente_financiero: true, recomendaciones_automaticas: true },
    });

    render(
      <MemoryRouter>
        <ConfiguracionPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Plan Premium')).toBeInTheDocument();
    expect(
      screen.getByText('Asistente financiero y recomendaciones avanzadas.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mejorar a Premium' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mejorar a Premium' })).not.toBeInTheDocument();
  });
});

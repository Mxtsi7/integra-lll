// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, getContratacion, getPermisosPlan, type ContratacionPlan, type PermisosPlan } from '@ojoalgasto/shared';
import { MENSAJE_PLAN_ACTIVANDO } from '../components/Planes/reglasContratacion';
import { PlanesRetornoPage } from './PlanesRetornoPage';

// Solo se simulan el layout, la sesión y la red. La página y sus reglas son las reales.
vi.mock('../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
// La función de sesión es estable, como en AuthProvider: si cambiara en cada render, la página se recargaría sin fin.
const sesionFija = vi.hoisted(() => () => 1);
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ capturarSesion: sesionFija }) }));
vi.mock('@ojoalgasto/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ojoalgasto/shared')>();
  return { ...real, getContratacion: vi.fn(), getPermisosPlan: vi.fn() };
});

const GRATUITO: PermisosPlan = { plan: 'free', features: { asistente_financiero: false, recomendaciones_automaticas: false } };
const PREMIUM: PermisosPlan = { plan: 'premium', features: { asistente_financiero: true, recomendaciones_automaticas: true } };

function contrato(estado: ContratacionPlan['estado']): ContratacionPlan {
  return {
    id: 'c-1',
    estado,
    plan_id: 'premium',
    importe: '4990.00',
    moneda: 'CLP',
    precio_demo: true,
    vigente_desde: null,
    vigente_hasta: null,
    url_checkout: 'https://pagos.ejemplo.cl/x',
    url_retorno: 'https://app.ejemplo.cl/planes/retorno',
    permisos: GRATUITO,
  };
}

function montar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <PlanesRetornoPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getContratacion).mockReset();
  vi.mocked(getPermisosPlan).mockReset();
});

afterEach(() => {
  cleanup();
});

describe('PlanesRetornoPage', () => {
  it('sin contratación en el enlace, no inventa un resultado', async () => {
    montar('/planes/retorno');
    await act(async () => {});

    expect(screen.getByText(/No encontramos la contratación/)).toBeInTheDocument();
    expect(getContratacion).not.toHaveBeenCalled();
  });

  it('pago aprobado pero plan aún gratuito: pide verificar y no muestra Premium', async () => {
    vi.mocked(getContratacion).mockResolvedValue(contrato('exitosa'));
    vi.mocked(getPermisosPlan).mockResolvedValue(GRATUITO);
    montar('/planes/retorno?contratacion_id=c-1');

    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument();
    expect(screen.getByText(MENSAJE_PLAN_ACTIVANDO)).toBeInTheDocument();
    expect(screen.queryByText(/Tu plan Premium está activo/)).toBeNull();
  });

  it('cuando el servidor confirma Premium, lo muestra como activo', async () => {
    vi.mocked(getContratacion).mockResolvedValue(contrato('exitosa'));
    vi.mocked(getPermisosPlan).mockResolvedValue(PREMIUM);
    montar('/planes/retorno?contratacion_id=c-1');

    expect(await screen.findByText(/Tu plan Premium está activo/)).toBeInTheDocument();
  });

  it('pago cancelado: lo dice y aclara que no hubo cobro', async () => {
    vi.mocked(getContratacion).mockResolvedValue(contrato('cancelada'));
    vi.mocked(getPermisosPlan).mockResolvedValue(GRATUITO);
    montar('/planes/retorno?contratacion_id=c-1');

    expect(await screen.findByText('Contratación cancelada')).toBeInTheDocument();
    expect(screen.getByText(/No se hizo ningún cobro/)).toBeInTheDocument();
  });

  it('una contratación que no existe en esta organización no se muestra', async () => {
    vi.mocked(getContratacion).mockRejectedValue(new ErrorDeApi('no existe', 404));
    montar('/planes/retorno?contratacion_id=c-x');

    expect(await screen.findByText(/No encontramos esa contratación/)).toBeInTheDocument();
  });
});

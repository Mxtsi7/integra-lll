// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContratacionPlan, PermisosPlan } from '@ojoalgasto/shared';
import { MENSAJE_PLAN_ACTIVANDO, TEXTO_PRECIO_DEMO } from './reglasContratacion';
import { PlanPremium } from './PlanPremium';

// Se simulan la sesión y el hook de contratación: aquí se prueba lo que la persona ve y puede tocar.
const estado = vi.hoisted(() => ({
  usuario: { id: '7', organizacion_id: 'org-a', rol: 'titular' } as { rol: string } | null,
  permisos: { tipo: 'listo', permisos: { plan: 'free', features: { asistente_financiero: false, recomendaciones_automaticas: false } } } as unknown,
  contratacion: {} as Record<string, unknown>,
}));
// La sincronización del plan con el contexto se prueba en PerfilPage.test; aquí solo hace falta que exista.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ usuario: estado.usuario, actualizarUsuario: () => true, capturarSesion: () => 1 }),
}));
vi.mock('../../hooks/usePermisosPlan', () => ({ usePermisosPlan: () => ({ estado: estado.permisos, reintentar: vi.fn() }) }));
vi.mock('../../hooks/useContratacionPremium', () => ({ useContratacionPremium: () => estado.contratacion }));

const GRATUITO: PermisosPlan = { plan: 'free', features: { asistente_financiero: false, recomendaciones_automaticas: false } };
const PREMIUM: PermisosPlan = { plan: 'premium', features: { asistente_financiero: true, recomendaciones_automaticas: true } };

function contratacionDe(extra: Partial<Record<string, unknown>> = {}) {
  return {
    contrato: null,
    idSinCargar: null,
    operacion: null,
    mensajeError: null,
    precioDemo: null,
    recuperando: false,
    contratar: vi.fn(),
    continuarPago: vi.fn(),
    verificar: vi.fn(),
    cancelar: vi.fn(),
    ...extra,
  };
}

beforeEach(() => {
  estado.usuario = { rol: 'titular' };
  estado.permisos = { tipo: 'listo', permisos: GRATUITO };
  estado.contratacion = contratacionDe();
});

afterEach(() => {
  cleanup();
});

describe('PlanPremium', () => {
  it('con plan gratuito, la titular puede pulsar «Mejorar a Premium»', () => {
    const contratar = vi.fn();
    estado.contratacion = contratacionDe({ contratar });
    render(<PlanPremium />);

    const boton = screen.getByRole('button', { name: 'Mejorar a Premium' }) as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    expect(contratar).toHaveBeenCalledTimes(1);
  });

  it('a quien no es titular le explica por qué no puede contratar', () => {
    estado.usuario = { rol: 'integrante' };
    render(<PlanPremium />);

    expect((screen.getByRole('button', { name: 'Mejorar a Premium' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Solo la persona titular/)).toBeInTheDocument();
  });

  it('dice que no hay cobro real solo si el plan lo confirma como demostración', () => {
    estado.contratacion = contratacionDe({ precioDemo: true });
    const { unmount } = render(<PlanPremium />);
    expect(screen.getByText(TEXTO_PRECIO_DEMO)).toBeInTheDocument();
    unmount();

    estado.contratacion = contratacionDe({ precioDemo: null });
    render(<PlanPremium />);
    expect(screen.queryByText(TEXTO_PRECIO_DEMO)).toBeNull();
  });

  it('con una contratación pendiente, Continuar al pago vuelve al pago de esa misma contratación', () => {
    const continuarPago = vi.fn();
    estado.contratacion = contratacionDe({ contrato: { id: 'c-1', estado: 'pendiente' } as ContratacionPlan, continuarPago });
    render(<PlanPremium />);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    expect(continuarPago).toHaveBeenCalledTimes(1);
  });

  it('con una contratación pendiente ofrece verificarla o cancelarla, no contratar de nuevo', () => {
    const verificar = vi.fn();
    const cancelar = vi.fn();
    estado.contratacion = contratacionDe({ contrato: { id: 'c-1', estado: 'pendiente' } as ContratacionPlan, verificar, cancelar });
    render(<PlanPremium />);

    expect(screen.queryByRole('button', { name: 'Mejorar a Premium' })).toBeNull();
    expect(screen.getByText(/Termina el pago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verificar estado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar contratación' }));
    expect(verificar).toHaveBeenCalledTimes(1);
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it('si el pago ya está confirmado pero el plan sigue gratuito, lo dice sin conceder Premium', () => {
    estado.contratacion = contratacionDe({ contrato: { id: 'c-1', estado: 'exitosa' } as ContratacionPlan });
    render(<PlanPremium />);

    expect(screen.getByText(MENSAJE_PLAN_ACTIVANDO)).toBeInTheDocument();
    expect(screen.getByText('Plan Gratuito')).toBeInTheDocument();
  });

  it('mientras se recupera una contratación guardada, no ofrece Mejorar a Premium', () => {
    estado.contratacion = contratacionDe({ recuperando: true });
    render(<PlanPremium />);

    expect(screen.queryByRole('button', { name: 'Mejorar a Premium' })).toBeNull();
  });

  it('mientras se vuelven a leer los permisos, el aviso de pago confirmado sigue y no reaparece Mejorar a Premium', () => {
    estado.permisos = { tipo: 'cargando' };
    estado.contratacion = contratacionDe({ contrato: { id: 'c-1', estado: 'exitosa' } as ContratacionPlan });
    render(<PlanPremium />);

    expect(screen.getByText(MENSAJE_PLAN_ACTIVANDO)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mejorar a Premium' })).toBeNull();
  });

  it('con plan Premium vigente no ofrece contratar', () => {
    estado.permisos = { tipo: 'listo', permisos: PREMIUM };
    render(<PlanPremium />);

    expect(screen.getByText('Plan Premium')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mejorar a Premium' })).toBeNull();
  });

  it('muestra el error de la última operación', () => {
    estado.contratacion = contratacionDe({ mensajeError: 'La contratación no está disponible por ahora. Inténtalo más tarde.' });
    render(<PlanPremium />);

    expect(screen.getByRole('alert')).toHaveTextContent('no está disponible');
  });
});

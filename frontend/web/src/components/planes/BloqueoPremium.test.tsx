// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermisosPlan } from '@ojoalgasto/shared';
import { BloqueoPremium } from './BloqueoPremium';

const PERMISOS_FREE: PermisosPlan = {
  plan: 'free',
  features: { asistente_financiero: false, recomendaciones_automaticas: false },
};

const PERMISOS_PREMIUM: PermisosPlan = {
  plan: 'premium',
  features: { asistente_financiero: true, recomendaciones_automaticas: true },
};

function renderConRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('BloqueoPremium (SE-02)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(cleanup);

  it('un usuario Free ve la restricción visual, el beneficio explicado, botón a /perfil y no accede al contenido', () => {
    renderConRouter(
      <BloqueoPremium
        feature="asistente_financiero"
        permisos={{ tipo: 'listo', permisos: PERMISOS_FREE }}
      >
        <button type="button" data-testid="accion-protegida">
          Preguntar al asistente
        </button>
      </BloqueoPremium>,
    );

    expect(screen.getByText('El asistente financiero es parte del plan Premium.')).toBeInTheDocument();
    expect(screen.getByText('Mientras tanto puedes seguir usando el resto de la app.')).toBeInTheDocument();
    const enlace = screen.getByRole('link', { name: 'Ver planes' });
    expect(enlace).toBeInTheDocument();
    expect(enlace).toHaveAttribute('href', '/perfil');
    // La acción protegida NO debe existir en el DOM
    expect(screen.queryByTestId('accion-protegida')).not.toBeInTheDocument();
  });

  it('un usuario Premium tiene la acción y el contenido completamente habilitados sin restricción', () => {
    renderConRouter(
      <BloqueoPremium
        feature="asistente_financiero"
        permisos={{ tipo: 'listo', permisos: PERMISOS_PREMIUM }}
      >
        <button type="button" data-testid="accion-protegida">
          Preguntar al asistente
        </button>
      </BloqueoPremium>,
    );

    expect(screen.getByTestId('accion-protegida')).toBeInTheDocument();
    expect(screen.queryByText(/parte del plan Premium/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver planes' })).not.toBeInTheDocument();
  });

  it('mientras carga el plan no concede acceso por omisión y muestra indicador', () => {
    renderConRouter(
      <BloqueoPremium
        feature="asistente_financiero"
        permisos={{ tipo: 'cargando' }}
      >
        <button type="button" data-testid="accion-protegida">
          Preguntar al asistente
        </button>
      </BloqueoPremium>,
    );

    expect(screen.getByRole('status', { name: 'Comprobando tu plan' })).toBeInTheDocument();
    expect(screen.queryByTestId('accion-protegida')).not.toBeInTheDocument();
    expect(screen.queryByText(/parte del plan Premium/i)).not.toBeInTheDocument();
  });

  it('si falla la consulta explica el rechazo, mantiene bloqueada la acción y permite reintentar', () => {
    const onReintentarMock = vi.fn();
    renderConRouter(
      <BloqueoPremium
        feature="asistente_financiero"
        permisos={{ tipo: 'error', mensaje: 'No pudimos comprobar tu plan. Intenta de nuevo.' }}
        onReintentar={onReintentarMock}
      >
        <button type="button" data-testid="accion-protegida">
          Preguntar al asistente
        </button>
      </BloqueoPremium>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('No pudimos comprobar tu plan. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByTestId('accion-protegida')).not.toBeInTheDocument();

    const botonReintentar = screen.getByRole('button', { name: 'Reintentar' });
    fireEvent.click(botonReintentar);
    expect(onReintentarMock).toHaveBeenCalledTimes(1);
  });

  it('aplica correctamente a otras funciones Premium como recomendaciones_automaticas', () => {
    renderConRouter(
      <BloqueoPremium
        feature="recomendaciones_automaticas"
        permisos={{ tipo: 'listo', permisos: PERMISOS_FREE }}
      >
        <div data-testid="recomendaciones-avanzadas">Sugerencias automáticas</div>
      </BloqueoPremium>,
    );

    expect(screen.getByText('El recomendaciones automáticas es parte del plan Premium.')).toBeInTheDocument();
    expect(screen.queryByTestId('recomendaciones-avanzadas')).not.toBeInTheDocument();
  });
});

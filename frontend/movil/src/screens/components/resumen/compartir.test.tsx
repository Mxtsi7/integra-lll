// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { textoDelResumen, type ResumenDelPeriodo } from '@ojoalgasto/shared';
import { BotonCompartirResumen } from './BotonCompartirResumen';
import { ResumenPeriodoContenido } from './ResumenPeriodoContenido';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function resumen(periodo = '2026-11'): ResumenDelPeriodo {
  return {
    periodo,
    conteo: { activo: 2, prueba: 0, por_confirmar: 1, cancelado: 1, fantasma: 0, total: 4 },
    gastos: [{ moneda: 'CLP', gastoReal: 25000, gastoProyectado: 12990, totalEstimado: 37990 }],
  };
}

describe('Compartir el resumen (AN-26)', () => {
  it('comparte el texto del resumen, con el periodo y la moneda de cada importe', async () => {
    const compartir = vi.fn().mockResolvedValue({ action: 'sharedAction' });
    render(<BotonCompartirResumen resumen={resumen()} compartir={compartir} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('compartir-resumen'));
    });

    expect(compartir).toHaveBeenCalledTimes(1);
    const mensaje = compartir.mock.calls[0][0] as string;
    expect(mensaje).toBe(textoDelResumen(resumen()));
    expect(mensaje).toContain('Noviembre de 2026');
    expect(mensaje).toContain('En CLP: gastado $25.000');
  });

  it('no comparte enlaces ni archivos: solo texto', async () => {
    const compartir = vi.fn().mockResolvedValue(undefined);
    render(<BotonCompartirResumen resumen={resumen()} compartir={compartir} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('compartir-resumen'));
    });
    expect(compartir.mock.calls[0]).toHaveLength(1);
    expect(compartir.mock.calls[0][0]).not.toMatch(/https?:|file:/);
  });

  it('comparte el periodo que se está viendo, no el actual', async () => {
    const compartir = vi.fn().mockResolvedValue(undefined);
    const api = { getResumenDelPeriodo: vi.fn().mockImplementation(async (mes: string) => resumen(mes)) };
    render(
      <ResumenPeriodoContenido
        variante="informe"
        api={api}
        renderAcciones={(actual) => <BotonCompartirResumen resumen={actual} compartir={compartir} />}
      />,
    );
    await screen.findByTestId('compartir-resumen');

    fireEvent.click(screen.getByTestId('periodo-anterior'));
    // Se espera a que cargue octubre FUERA de act: dentro de act no se actualizaría la pantalla.
    const boton = await screen.findByTestId('compartir-resumen');
    await act(async () => {
      fireEvent.click(boton);
    });

    expect(compartir.mock.calls[0][0]).toContain('Octubre de 2026');
    expect(compartir.mock.calls[0][0]).not.toContain('Noviembre de 2026');
  });

  it('si se cancela el menú no pasa nada: no hay error y se puede volver a compartir', async () => {
    const compartir = vi.fn().mockResolvedValue({ action: 'dismissedAction' });
    render(<BotonCompartirResumen resumen={resumen()} compartir={compartir} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('compartir-resumen'));
    });

    expect(screen.queryByTestId('error-compartir')).toBeNull();
    expect(screen.queryByText(/compartido|enviado/i)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('compartir-resumen'));
    });
    expect(compartir).toHaveBeenCalledTimes(2);
  });

  it('si el teléfono no puede abrir el menú, avisa y deja reintentar', async () => {
    const compartir = vi.fn().mockRejectedValueOnce(new Error('sin menú')).mockResolvedValue(undefined);
    render(<BotonCompartirResumen resumen={resumen()} compartir={compartir} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('compartir-resumen'));
    });
    expect(screen.getByTestId('error-compartir').textContent).toContain('No pudimos abrir el menú para compartir');

    await act(async () => {
      fireEvent.click(screen.getByTestId('compartir-resumen'));
    });
    expect(screen.queryByTestId('error-compartir')).toBeNull();
  });

  it('un doble toque abre el menú una sola vez', async () => {
    let terminar: () => void = () => {};
    const compartir = vi.fn(() => new Promise<void>((resolver) => (terminar = resolver)));
    render(<BotonCompartirResumen resumen={resumen()} compartir={compartir} />);

    const boton = screen.getByTestId('compartir-resumen');
    fireEvent.click(boton);
    fireEvent.click(boton);

    expect(compartir).toHaveBeenCalledTimes(1);
    await act(async () => terminar());
  });

  it('el botón de compartir solo aparece cuando el informe ya cargó', async () => {
    let responder: (valor: ResumenDelPeriodo) => void = () => {};
    const api = { getResumenDelPeriodo: vi.fn(() => new Promise<ResumenDelPeriodo>((resolver) => (responder = resolver))) };
    render(
      <ResumenPeriodoContenido
        variante="informe"
        api={api}
        renderAcciones={(actual) => <BotonCompartirResumen resumen={actual} compartir={vi.fn()} />}
      />,
    );
    expect(screen.queryByTestId('compartir-resumen')).toBeNull();

    await act(async () => responder(resumen()));
    expect(screen.getByTestId('compartir-resumen')).toBeTruthy();
  });
});

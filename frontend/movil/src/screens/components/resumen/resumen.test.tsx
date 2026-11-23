// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ResumenDelPeriodo } from '@ojoalgasto/shared';
import { ResumenPeriodoContenido } from './ResumenPeriodoContenido';
import type { ApiResumen } from './useResumenPeriodo';

// "Hoy" fijo: solo se falsea Date, para que waitFor y los temporizadores sigan funcionando.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CONTEO = { activo: 2, prueba: 0, por_confirmar: 1, cancelado: 1, fantasma: 0, total: 4 };

function resumen(cambios: Partial<ResumenDelPeriodo> = {}): ResumenDelPeriodo {
  return {
    periodo: '2026-11',
    conteo: CONTEO,
    gastos: [
      { moneda: 'CLP', gastoReal: 25000, gastoProyectado: 12990, totalEstimado: 37990 },
      { moneda: 'USD', gastoReal: 10.5, gastoProyectado: 0, totalEstimado: 10.5 },
    ],
    ...cambios,
  };
}

function crearApi(respuesta: ResumenDelPeriodo = resumen()): ApiResumen {
  return { getResumenDelPeriodo: vi.fn().mockResolvedValue(respuesta) };
}

describe('Resumen de gasto móvil (AN-01)', () => {
  it('muestra el gasto de cada moneda por separado, sin sumarlas, y la cantidad por estado', async () => {
    render(<ResumenPeriodoContenido variante="panel" api={crearApi()} />);

    const clp = await screen.findByTestId('gasto-CLP');
    expect(clp.textContent).toContain('$25.000');
    expect(clp.textContent).toContain('$12.990');
    const usd = screen.getByTestId('gasto-USD');
    expect(usd.textContent).toContain('10,50');
    expect(clp.textContent).not.toContain('10,50');

    const conteo = screen.getByTestId('conteo-estados').textContent ?? '';
    expect(conteo).toContain('Suscripciones: 4');
    expect(conteo).toContain('Activas2');
    expect(conteo).toContain('Canceladas1');
  });

  it('pide el mes de hoy y el título dice el periodo', async () => {
    const api = crearApi();
    render(<ResumenPeriodoContenido variante="panel" api={api} />);
    await screen.findByTestId('gasto-CLP');

    expect(api.getResumenDelPeriodo).toHaveBeenCalledWith('2026-11');
    expect(screen.getByTestId('titulo-periodo').textContent).toBe('Noviembre de 2026');
  });

  it('omite la moneda sin movimiento', async () => {
    const api = crearApi(resumen({ gastos: [resumen().gastos[0], { moneda: 'USD', gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }] }));
    render(<ResumenPeriodoContenido variante="panel" api={api} />);
    await screen.findByTestId('gasto-CLP');
    expect(screen.queryByTestId('gasto-USD')).toBeNull();
  });

  it('la variante panel no muestra el total estimado ni el texto del informe', async () => {
    render(<ResumenPeriodoContenido variante="panel" api={crearApi()} />);
    await screen.findByTestId('gasto-CLP');
    expect(screen.queryByText('Total estimado')).toBeNull();
    expect(screen.queryByTestId('resumen-texto')).toBeNull();
  });

  it('sin gastos ni suscripciones muestra el estado vacío, sin NaN', async () => {
    const vacio = resumen({ conteo: { activo: 0, prueba: 0, por_confirmar: 0, cancelado: 0, fantasma: 0, total: 0 }, gastos: [{ moneda: 'CLP', gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }] });
    render(<ResumenPeriodoContenido variante="panel" api={crearApi(vacio)} />);
    expect(await screen.findByText('Sin movimiento en este periodo')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('con suscripciones pero sin gastos lo dice y muestra la cantidad por estado', async () => {
    const api = crearApi(resumen({ gastos: [{ moneda: 'CLP', gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }] }));
    render(<ResumenPeriodoContenido variante="panel" api={api} />);
    expect(await screen.findByTestId('sin-gastos')).toBeTruthy();
    expect(screen.getByTestId('conteo-estados').textContent).toContain('Suscripciones: 4');
  });

  it('si falla muestra el error y Reintentar vuelve a pedir', async () => {
    const getResumenDelPeriodo = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue(resumen());
    render(<ResumenPeriodoContenido variante="panel" api={{ getResumenDelPeriodo }} />);
    fireEvent.click(await screen.findByRole('button', { name: /reintentar/i }));
    expect(await screen.findByTestId('gasto-CLP')).toBeTruthy();
    expect(getResumenDelPeriodo).toHaveBeenCalledTimes(2);
  });

  it('al cambiar de periodo pide el mes anterior y no deja las cifras del mes viejo', async () => {
    const getResumenDelPeriodo = vi.fn().mockImplementation(async (mes: string) => resumen({ periodo: mes }));
    render(<ResumenPeriodoContenido variante="panel" api={{ getResumenDelPeriodo }} />);
    await screen.findByTestId('gasto-CLP');

    fireEvent.click(screen.getByTestId('periodo-anterior'));

    expect(screen.getByTestId('titulo-periodo').textContent).toBe('Octubre de 2026');
    expect(screen.queryByTestId('gasto-CLP')).toBeNull(); // cargando, no las cifras de noviembre
    await screen.findByTestId('gasto-CLP');
    expect(getResumenDelPeriodo).toHaveBeenLastCalledWith('2026-10');
  });

  it('una respuesta que llega tarde del mes anterior no pisa al mes actual', async () => {
    let responderNoviembre: (valor: ResumenDelPeriodo) => void = () => {};
    const getResumenDelPeriodo = vi.fn().mockImplementation((mes: string) =>
      mes === '2026-11'
        ? new Promise<ResumenDelPeriodo>((resolver) => (responderNoviembre = resolver))
        : Promise.resolve(resumen({ periodo: mes, gastos: [{ moneda: 'CLP', gastoReal: 111, gastoProyectado: 0, totalEstimado: 111 }] })),
    );
    render(<ResumenPeriodoContenido variante="panel" api={{ getResumenDelPeriodo }} />);

    fireEvent.click(screen.getByTestId('periodo-anterior')); // se deja noviembre antes de que responda
    const octubre = await screen.findByTestId('gasto-CLP');
    expect(octubre.textContent).toContain('$111');
    await act(async () => responderNoviembre(resumen()));

    expect(screen.getByTestId('gasto-CLP').textContent).toContain('$111');
    expect(screen.getByTestId('titulo-periodo').textContent).toBe('Octubre de 2026');
  });

  it('no se puede avanzar más allá del mes actual', async () => {
    render(<ResumenPeriodoContenido variante="panel" api={crearApi()} />);
    await screen.findByTestId('gasto-CLP');
    expect((screen.getByTestId('periodo-siguiente') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('periodo-anterior'));
    await screen.findByTestId('gasto-CLP');
    expect((screen.getByTestId('periodo-siguiente') as HTMLButtonElement).disabled).toBe(false);
  });

  it('al volver a la pantalla refresca sin vaciarla, y si falla deja las cifras que había', async () => {
    let avisarFoco: () => void = () => {};
    const alVolverAPantalla = (recargar: () => void) => {
      avisarFoco = recargar;
      return () => {};
    };
    const getResumenDelPeriodo = vi.fn().mockResolvedValueOnce(resumen()).mockRejectedValue(new Error('sin red'));
    render(<ResumenPeriodoContenido variante="panel" alVolverAPantalla={alVolverAPantalla} api={{ getResumenDelPeriodo }} />);
    await screen.findByTestId('gasto-CLP');

    await act(async () => avisarFoco());

    expect(getResumenDelPeriodo).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('gasto-CLP').textContent).toContain('$25.000');
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull();
  });
});

describe('Informes móviles por periodo (AN-23)', () => {
  it('muestra el total estimado de cada moneda y el resumen en texto con periodo y moneda', async () => {
    render(<ResumenPeriodoContenido variante="informe" api={crearApi()} />);
    const clp = await screen.findByTestId('gasto-CLP');

    expect(clp.textContent).toContain('Total estimado');
    expect(clp.textContent).toContain('$37.990');
    const texto = screen.getByTestId('resumen-texto').textContent ?? '';
    expect(texto).toContain('Resumen de Noviembre de 2026.');
    expect(texto).toContain('En CLP: gastado $25.000');
    expect(texto).toContain('En USD:');
  });

  it('el informe vacío no produce NaN ni un gráfico engañoso: dice que no hay gastos', async () => {
    const api = crearApi(resumen({ gastos: [{ moneda: 'CLP', gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }] }));
    render(<ResumenPeriodoContenido variante="informe" api={api} />);
    await screen.findByTestId('sin-gastos');
    expect(screen.getByTestId('resumen-texto').textContent).toContain('Sin gastos registrados ni proyectados.');
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it('deja un lugar para la acción de compartir (AN-26), que recibe el resumen cargado', async () => {
    const renderAcciones = vi.fn(() => <span data-testid="accion-compartir">Compartir</span>);
    render(<ResumenPeriodoContenido variante="informe" api={crearApi()} renderAcciones={renderAcciones} />);
    expect(await screen.findByTestId('accion-compartir')).toBeTruthy();
    expect(renderAcciones).toHaveBeenCalledWith(expect.objectContaining({ periodo: '2026-11' }));
  });

  it('sin la acción de compartir no muestra ningún botón de compartir', async () => {
    render(<ResumenPeriodoContenido variante="informe" api={crearApi()} />);
    await screen.findByTestId('gasto-CLP');
    expect(screen.queryByTestId('accion-compartir')).toBeNull();
  });
});

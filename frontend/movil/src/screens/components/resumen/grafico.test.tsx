// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GastoPorMoneda, ResumenDelPeriodo } from '@ojoalgasto/shared';
import { GraficoGastos } from './GraficoGastos';
import { ResumenPeriodoContenido } from './ResumenPeriodoContenido';
import { datosDelGrafico } from './reglasGrafico';

// "Hoy" fijo: solo se falsea Date, para que waitFor y los temporizadores sigan funcionando.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CLP: GastoPorMoneda = { moneda: 'CLP', gastoReal: 25000, gastoProyectado: 12990, totalEstimado: 37990 };

describe('datos del gráfico (AN-02)', () => {
  it('reparte en porcentajes que siempre suman 100', () => {
    for (const [real, proyectado] of [[1, 2], [1, 1], [1, 1000], [2, 1], [333, 667], [7, 0], [0, 7]]) {
      const grafico = datosDelGrafico({ ...CLP, gastoReal: real, gastoProyectado: proyectado });
      expect(grafico!.partes[0].porcentaje + grafico!.partes[1].porcentaje).toBe(100);
    }
  });

  it('usa los mismos importes con formato que las filas de la tarjeta', () => {
    const grafico = datosDelGrafico(CLP)!;
    expect(grafico.partes.map((parte) => parte.importe)).toEqual(['$25.000', '$12.990']);
    expect(grafico.partes.map((parte) => parte.porcentaje)).toEqual([66, 34]);
  });

  it('la descripción dice la moneda, los importes y los porcentajes', () => {
    expect(datosDelGrafico(CLP)!.descripcion).toBe('Gráfico de gasto en CLP: gastado $25.000 (66%), por cobrar $12.990 (34%).');
  });

  it.each([
    ['total en cero', { gastoReal: 0, gastoProyectado: 0 }],
    ['importe que no es número', { gastoReal: Number.NaN, gastoProyectado: 5 }],
    ['importe infinito', { gastoReal: Number.POSITIVE_INFINITY, gastoProyectado: 5 }],
    ['importe negativo', { gastoReal: -5, gastoProyectado: 10 }],
  ])('no dibuja nada con %s', (_caso, cambio) => {
    expect(datosDelGrafico({ ...CLP, ...cambio })).toBeNull();
  });
});

describe('gráfico de gastos móvil (AN-02)', () => {
  it('dice lo mismo que el texto: descripción accesible, leyenda y barra', () => {
    render(<GraficoGastos gasto={CLP} />);
    const grafico = screen.getByTestId('grafico-CLP');

    expect(grafico.getAttribute('accessibilitylabel')).toBe(datosDelGrafico(CLP)!.descripcion);
    expect(grafico.getAttribute('role')).toBe('image');
    expect(grafico.textContent).toContain('Gastado 66%');
    expect(grafico.textContent).toContain('Por cobrar 34%');
  });

  it('con una sola parte (todo gastado) dibuja una barra y no una parte vacía', () => {
    render(<GraficoGastos gasto={{ ...CLP, gastoProyectado: 0 }} />);
    expect(screen.getByTestId('grafico-CLP').textContent).toContain('Gastado 100%');
    expect(screen.getByTestId('grafico-CLP').textContent).toContain('Por cobrar 0%');
  });

  it('sin gasto no dibuja un gráfico que parezca un dato', () => {
    render(<GraficoGastos gasto={{ ...CLP, gastoReal: 0, gastoProyectado: 0 }} />);
    expect(screen.queryByTestId('grafico-CLP')).toBeNull();
  });

  const resumen: ResumenDelPeriodo = {
    periodo: '2026-11',
    conteo: { activo: 2, prueba: 0, por_confirmar: 1, cancelado: 1, fantasma: 0, total: 4 },
    gastos: [CLP, { moneda: 'USD', gastoReal: 10.5, gastoProyectado: 0, totalEstimado: 10.5 }],
  };

  it('el Panel muestra un gráfico por cada moneda con movimiento, dentro de su tarjeta y sin mezclar monedas', async () => {
    render(<ResumenPeriodoContenido variante="panel" api={{ getResumenDelPeriodo: vi.fn().mockResolvedValue(resumen) }} />);
    const clp = await screen.findByTestId('gasto-CLP');

    expect(clp.querySelector('[data-testid="grafico-CLP"]')).not.toBeNull();
    expect(clp.querySelector('[data-testid="grafico-USD"]')).toBeNull();
    expect(screen.getByTestId('gasto-USD').querySelector('[data-testid="grafico-USD"]')).not.toBeNull();
    // Las cifras de la tarjeta son las mismas del gráfico.
    expect(clp.textContent).toContain('$25.000');
    expect(screen.getByTestId('grafico-CLP').getAttribute('accessibilitylabel')).toContain('$25.000');
  });

  it('el Informe también lo muestra', async () => {
    render(<ResumenPeriodoContenido variante="informe" api={{ getResumenDelPeriodo: vi.fn().mockResolvedValue(resumen) }} />);
    expect(await screen.findByTestId('grafico-CLP')).toBeTruthy();
  });

  it('un periodo sin gasto no muestra gráfico: solo el texto', async () => {
    const vacio = { ...resumen, gastos: [{ ...CLP, gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }] };
    render(<ResumenPeriodoContenido variante="panel" api={{ getResumenDelPeriodo: vi.fn().mockResolvedValue(vacio) }} />);
    expect(await screen.findByTestId('sin-gastos')).toBeTruthy();
    expect(screen.queryByTestId('grafico-CLP')).toBeNull();
  });
});

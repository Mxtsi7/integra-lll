// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResumenDelMes } from '@ojoalgasto/shared';
import { resumenDePrueba } from '../../test/informesDePrueba';
import { GraficoDeGastos } from './GraficoDeGastos';

const mes = (periodo: string, real: string, proyectado = '0.00', moneda = 'CLP'): ResumenDelMes =>
  resumenDePrueba({
    periodo,
    moneda,
    gasto_real: real,
    gasto_proyectado: proyectado,
    total_estimado: (Number(real) + Number(proyectado)).toFixed(2),
  });

// El más alto (agosto y octubre, 40.000) fija el 100 %.
const SEIS_MESES = [
  mes('2026-05', '0.00'),
  mes('2026-06', '10000.00'),
  mes('2026-07', '20000.00'),
  mes('2026-08', '40000.00'),
  mes('2026-09', '5.00'),
  mes('2026-10', '30000.00', '10000.00'),
];

const montar = (meses: ResumenDelMes[] = SEIS_MESES, mesElegido = '2026-10') =>
  render(<GraficoDeGastos meses={meses} mesElegido={mesElegido} />);

/** Las columnas del dibujo, en orden, y la pila de cada una. */
const columnas = () => Array.from(screen.getByRole('img').children) as HTMLElement[];
const pila = (columna: HTMLElement) => columna.firstElementChild as HTMLElement;

afterEach(() => {
  cleanup();
});

describe('el gráfico de gastos (S3-CH-25)', () => {
  it('dice qué muestra y en qué moneda, y manda a la tabla para los valores', () => {
    montar();

    const dibujo = screen.getByRole('img');
    expect(dibujo).toHaveAccessibleName(/CLP/);
    expect(dibujo).toHaveAccessibleName(/mayo de 2026/);
    expect(dibujo).toHaveAccessibleName(/octubre de 2026/);
    expect(dibujo).toHaveAccessibleName(/tabla/);
  });

  it('dibuja una columna por mes, en el orden de los datos', () => {
    montar();

    expect(columnas()).toHaveLength(6);
  });

  it('la altura de cada columna es proporcional al total del mes, respecto del más alto', () => {
    montar();

    expect(columnas().map((columna) => pila(columna).style.height)).toEqual(['0%', '25%', '50%', '100%', '2%', '100%']);
  });

  it('un mes con un monto mínimo se ve igual, y uno sin gasto no dibuja nada', () => {
    montar();

    const [sinGasto, , , , minimo] = columnas();
    expect(pila(sinGasto).style.height).toBe('0%');
    expect(pila(minimo).style.height).toBe('2%');
  });

  it('cada columna reparte su altura entre lo real y lo proyectado según sus montos', () => {
    montar();

    const [real, proyectado] = Array.from(pila(columnas()[5]).children) as HTMLElement[];
    expect(real.style.flexGrow).toBe('30000');
    expect(proyectado.style.flexGrow).toBe('10000');
  });

  it('con todo en cero no inventa una altura', () => {
    montar([mes('2026-09', '0.00'), mes('2026-10', '0.00')]);

    expect(columnas().map((columna) => pila(columna).style.height)).toEqual(['0%', '0%']);
  });

  it('un monto que no es número no dibuja una barra', () => {
    montar([mes('2026-09', 'abc'), mes('2026-10', '1000.00')]);

    expect(columnas().map((columna) => pila(columna).style.height)).toEqual(['0%', '100%']);
  });

  it('destaca el mes elegido, solo ese', () => {
    montar(SEIS_MESES, '2026-08');

    const destacadas = columnas().map((columna) => columna.className.includes('columnaElegida'));
    expect(destacadas).toEqual([false, false, false, true, false, false]);
  });
});

describe('la tabla del detalle (S3-CH-25)', () => {
  it('trae una fila por mes con sus tres montos, formateados', () => {
    montar();

    const filas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(filas).toHaveLength(6);
    expect(filas.map((fila) => within(fila).getByRole('rowheader').textContent)).toEqual([
      'Mayo de 2026',
      'Junio de 2026',
      'Julio de 2026',
      'Agosto de 2026',
      'Septiembre de 2026',
      'Octubre de 2026',
    ]);
    expect(Array.from(filas[5].querySelectorAll('td')).map((celda) => celda.textContent)).toEqual(['$30.000', '$10.000', '$40.000']);
  });

  it('marca como actual la fila del mes elegido, y solo esa', () => {
    montar(SEIS_MESES, '2026-07');

    const filas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(filas.map((fila) => fila.getAttribute('aria-current'))).toEqual([null, null, 'true', null, null, null]);
  });

  it('tiene encabezados para leerla con lector de pantalla', () => {
    montar();

    expect(screen.getAllByRole('columnheader').map((celda) => celda.textContent)).toEqual([
      'Mes',
      'Gasto real',
      'Gasto proyectado',
      'Total estimado',
    ]);
    expect(screen.getByRole('table', { name: 'Detalle por mes' })).toBeInTheDocument();
  });

  it('muestra los montos en la moneda de los datos, sin convertir', () => {
    montar([mes('2026-09', '4.50', '0.00', 'USD'), mes('2026-10', '9.00', '0.00', 'USD')]);

    expect(screen.getByRole('img')).toHaveAccessibleName(/USD/);
    expect(within(screen.getByRole('table')).getAllByRole('row')[2]).toHaveTextContent(/9,00/);
    expect(screen.queryByText('$9')).not.toBeInTheDocument();
  });
});

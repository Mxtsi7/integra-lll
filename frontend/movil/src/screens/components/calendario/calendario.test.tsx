// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CobroCalendario } from '@ojoalgasto/shared';
import { CalendarioContenido } from './CalendarioContenido';
import { esDelMes, isoDeFecha, semanasDelMes, sumarMeses } from './fechas';
import { cobrosDelDia, contarPorDia, formatearImporte, totalesPorMoneda } from './reglasCalendario';
import type { ApiCalendario } from './useCobrosDelMes';
import { NavigationContainer } from '@react-navigation/native';
// Simulación para que useFocusEffect funcione en los tests sin NavigationContainer
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    React.useEffect(() => {
      callback();
    }, [callback]);
  },
}));
const HOY = '2026-11-09';

function crearCobro(id: string, fecha: string, cambios: Partial<CobroCalendario> = {}): CobroCalendario {
  return { id, suscripcion_id: `s-${id}`, fecha, servicio: `Servicio ${id}`, importe: 9990, moneda: 'CLP', tipo: 'confirmado', ...cambios };
}

const COBROS_NOVIEMBRE = [
  crearCobro('c1', '2026-11-09'),
  crearCobro('c2', '2026-11-09', { importe: 4.5, moneda: 'USD' }),
  crearCobro('c3', '2026-11-30', { tipo: 'proyectado' }),
];

function crearApi(cobros: CobroCalendario[] = COBROS_NOVIEMBRE): ApiCalendario {
  return { getCobrosDelMes: vi.fn().mockResolvedValue(cobros) };
}

afterEach(() => {
  cleanup();
});

describe('fechas del calendario', () => {
  it('isoDeFecha usa el día local: el 30 de noviembre sigue siendo 30', () => {
    expect(isoDeFecha(new Date(2026, 10, 30, 23, 59))).toBe('2026-11-30');
    expect(isoDeFecha(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('sumarMeses cruza el cambio de año', () => {
    expect(sumarMeses('2026-12', 1)).toBe('2027-01');
    expect(sumarMeses('2026-01', -1)).toBe('2025-12');
  });

  it('semanasDelMes parte en lunes: noviembre de 2026 empieza en domingo', () => {
    const semanas = semanasDelMes('2026-11');
    expect(semanas[0].slice(0, 6).every((casilla) => casilla === null)).toBe(true);
    expect(semanas[0][6]).toBe('2026-11-01');
    expect(semanas.every((semana) => semana.length === 7)).toBe(true);
  });

  it('esDelMes distingue meses', () => {
    expect(esDelMes('2026-11-09', '2026-11')).toBe(true);
    expect(esDelMes('2026-12-01', '2026-11')).toBe(false);
  });
});

describe('reglas del calendario', () => {
  it('los cobros de un día y el conteo salen de la misma lista', () => {
    expect(cobrosDelDia(COBROS_NOVIEMBRE, '2026-11-09').map((cobro) => cobro.id)).toEqual(['c1', 'c2']);
    expect(contarPorDia(COBROS_NOVIEMBRE)).toEqual({ '2026-11-09': 2, '2026-11-30': 1 });
  });

  it('los totales van separados por moneda', () => {
    expect(totalesPorMoneda(COBROS_NOVIEMBRE)).toEqual([
      { moneda: 'CLP', total: 19980 },
      { moneda: 'USD', total: 4.5 },
    ]);
  });

  it('una moneda desconocida no rompe el formato', () => {
    expect(formatearImporte(10, 'ZZ')).toBe('ZZ 10');
  });
});

describe('Calendario móvil (AN-07)', () => {
  it('abre en el mes de hoy y muestra los cobros del día de hoy', async () => {
    const api = crearApi();
    render(<CalendarioContenido hoyInicial={HOY} api={api} />);
    expect(await screen.findByTestId('cuadricula-mes')).toBeTruthy();
    expect(screen.getByTestId('titulo-mes').textContent).toBe('Noviembre de 2026');
    expect(api.getCobrosDelMes).toHaveBeenCalledWith('2026-11');
    expect(screen.getByTestId('dia-2026-11-09').getAttribute('aria-label')).toContain('2 cobros');
  });

  it('elegir un día muestra sus cobros y la agenda sigue mostrando todo el mes', async () => {
    render(<CalendarioContenido hoyInicial={HOY} api={crearApi()} />);
    fireEvent.click(await screen.findByTestId('dia-2026-11-30'));
    // c3 aparece dos veces: en el día elegido y en la agenda. c1 solo en la agenda.
    expect(screen.getAllByTestId('cobro-c3')).toHaveLength(2);
    expect(screen.getAllByTestId('cobro-c1')).toHaveLength(1);
  });

  it('un día sin cobros lo dice', async () => {
    render(<CalendarioContenido hoyInicial={HOY} api={crearApi()} />);
    fireEvent.click(await screen.findByTestId('dia-2026-11-15'));
    expect(screen.getByText('No hay cobros este día.')).toBeTruthy();
  });

  it('los totales del mes no mezclan monedas', async () => {
    render(<CalendarioContenido hoyInicial={HOY} api={crearApi()} />);
    const totales = (await screen.findByTestId('totales-mes')).textContent ?? '';
    expect(totales).toContain('CLP');
    expect(totales).toContain('USD');
  });

  it('los proyectados se marcan como tales', async () => {
    render(<CalendarioContenido hoyInicial={HOY} api={crearApi()} />);
    await screen.findByTestId('cuadricula-mes');
    expect(screen.getAllByText(/Proyectado/).length).toBeGreaterThan(0);
  });

  it('cambiar de mes pide ese mes y "Hoy" vuelve al mes actual', async () => {
    const api = crearApi();
    render(<CalendarioContenido hoyInicial={HOY} api={api} />);
    await screen.findByTestId('cuadricula-mes');
    fireEvent.click(screen.getByTestId('mes-siguiente'));
    await waitFor(() => expect(api.getCobrosDelMes).toHaveBeenLastCalledWith('2026-12'));
    expect(screen.getByTestId('titulo-mes').textContent).toBe('Diciembre de 2026');
    fireEvent.click(screen.getByTestId('ir-a-hoy'));
    await waitFor(() => expect(api.getCobrosDelMes).toHaveBeenLastCalledWith('2026-11'));
  });

  it('una respuesta tardía de un mes anterior no pisa el mes actual', async () => {
    let responderNoviembre: (cobros: CobroCalendario[]) => void = () => {};
    const getCobrosDelMes = vi
      .fn()
      .mockImplementationOnce(() => new Promise<CobroCalendario[]>((resolver) => (responderNoviembre = resolver)))
      .mockResolvedValue([crearCobro('d1', '2026-12-10', { servicio: 'Cobro de diciembre' })]);
    render(<CalendarioContenido hoyInicial={HOY} api={{ getCobrosDelMes }} />);
    fireEvent.click(screen.getByTestId('mes-siguiente'));
    await screen.findAllByText('Cobro de diciembre');
    responderNoviembre([crearCobro('c9', '2026-11-09', { servicio: 'Cobro de noviembre' })]);
    await Promise.resolve();
    expect(screen.queryByText('Cobro de noviembre')).toBeNull();
    expect(screen.getAllByText('Cobro de diciembre').length).toBeGreaterThan(0);
  });

  it('mes sin cobros muestra el estado vacío', async () => {
    render(<CalendarioContenido hoyInicial={HOY} api={crearApi([])} />);
    expect(await screen.findByText('Sin cobros este mes')).toBeTruthy();
  });

  it('si falla muestra error y reintentar vuelve a pedir', async () => {
    const getCobrosDelMes = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue(COBROS_NOVIEMBRE);
    render(<CalendarioContenido hoyInicial={HOY} api={{ getCobrosDelMes }} />);
    fireEvent.click(await screen.findByRole('button', { name: /reintentar/i }));
    expect(await screen.findByTestId('cuadricula-mes')).toBeTruthy();
  });
});

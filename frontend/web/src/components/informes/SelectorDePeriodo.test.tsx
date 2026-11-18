// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpcionCatalogo } from '@ojoalgasto/shared';
import { SelectorDePeriodo } from './SelectorDePeriodo';

const MONEDAS: OpcionCatalogo[] = [
  { codigo: 'CLP', nombre: 'Peso chileno', activo: true, orden: 1 },
  { codigo: 'USD', nombre: 'Dólar', activo: true, orden: 2 },
];

const montar = (parcial: Partial<React.ComponentProps<typeof SelectorDePeriodo>> = {}) => {
  const manejadores = { onIrAMes: vi.fn(), onMesActual: vi.fn(), onCambiarMoneda: vi.fn() };
  render(<SelectorDePeriodo mes="2026-10" moneda="CLP" monedas={MONEDAS} {...manejadores} {...parcial} />);
  return manejadores;
};

afterEach(() => {
  cleanup();
});

describe('el selector de mes y moneda (S3-CH-25)', () => {
  it('dice el mes que se mira como título, con mayúscula', () => {
    montar();

    expect(screen.getByRole('heading', { name: 'Octubre de 2026' })).toBeInTheDocument();
  });

  it('las flechas dicen a qué mes llevan y van a ese mes', () => {
    const { onIrAMes } = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior: septiembre de 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente: noviembre de 2026' }));

    expect(onIrAMes.mock.calls).toEqual([['2026-09'], ['2026-11']]);
  });

  it('las flechas cruzan el cambio de año', () => {
    const { onIrAMes } = montar({ mes: '2026-12' });
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente: enero de 2027' }));
    cleanup();
    const otro = montar({ mes: '2026-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior: diciembre de 2025' }));

    expect(onIrAMes).toHaveBeenCalledWith('2027-01');
    expect(otro.onIrAMes).toHaveBeenCalledWith('2025-12');
  });

  it('«Mes actual» avisa que se quiere volver al mes de hoy', () => {
    const { onMesActual, onIrAMes } = montar({ mes: '2026-03' });

    fireEvent.click(screen.getByRole('button', { name: 'Mes actual' }));

    expect(onMesActual).toHaveBeenCalledTimes(1);
    expect(onIrAMes).not.toHaveBeenCalled();
  });

  it('ofrece cada moneda con su nombre y deja elegida la actual', () => {
    montar({ moneda: 'USD' });

    const selector = screen.getByRole('combobox', { name: 'Moneda' });
    expect(selector).toHaveValue('USD');
    expect(Array.from(selector.querySelectorAll('option')).map((opcion) => opcion.textContent)).toEqual([
      'CLP · Peso chileno',
      'USD · Dólar',
    ]);
  });

  it('elegir otra moneda la avisa', () => {
    const { onCambiarMoneda } = montar();

    fireEvent.change(screen.getByRole('combobox', { name: 'Moneda' }), { target: { value: 'USD' } });

    expect(onCambiarMoneda).toHaveBeenCalledWith('USD');
  });
});

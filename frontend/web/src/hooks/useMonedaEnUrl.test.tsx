// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useMonedaEnUrl } from './useMonedaEnUrl';

const montar = (ruta: string, monedas: string[], predeterminada: string | null) =>
  renderHook(
    () => ({ ...useMonedaEnUrl(monedas, predeterminada), ubicacion: useLocation() }),
    { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[ruta]}>{children}</MemoryRouter> },
  );

afterEach(() => {
  cleanup();
});

describe('la moneda en la URL (S3-CH-25)', () => {
  it('usa la que pide la URL si está entre las disponibles', () => {
    const { result } = montar('/informes?moneda=USD', ['CLP', 'USD'], 'CLP');

    expect(result.current.moneda).toBe('USD');
  });

  it('sin moneda en la URL usa la predeterminada', () => {
    const { result } = montar('/informes', ['USD', 'CLP'], 'CLP');

    expect(result.current.moneda).toBe('CLP');
  });

  it('una moneda que no existe o está mal escrita no se pide: usa la predeterminada', () => {
    expect(montar('/informes?moneda=XXX', ['CLP', 'USD'], 'CLP').result.current.moneda).toBe('CLP');
    expect(montar('/informes?moneda=usd', ['CLP', 'USD'], 'CLP').result.current.moneda).toBe('CLP');
    expect(montar('/informes?moneda=', ['CLP', 'USD'], 'CLP').result.current.moneda).toBe('CLP');
  });

  it('si la predeterminada tampoco está disponible, usa la primera', () => {
    expect(montar('/informes', ['USD', 'EUR'], 'CLP').result.current.moneda).toBe('USD');
    expect(montar('/informes', ['USD', 'EUR'], null).result.current.moneda).toBe('USD');
  });

  it('sin monedas disponibles no hay moneda', () => {
    expect(montar('/informes?moneda=CLP', [], 'CLP').result.current.moneda).toBeNull();
  });

  it('cambiar de moneda la pone en la URL y conserva el mes', () => {
    const { result } = montar('/informes?mes=2026-09&moneda=CLP', ['CLP', 'USD'], 'CLP');

    act(() => result.current.irAMoneda('USD'));

    const parametros = new URLSearchParams(result.current.ubicacion.search);
    expect(parametros.get('moneda')).toBe('USD');
    expect(parametros.get('mes')).toBe('2026-09');
    expect(result.current.moneda).toBe('USD');
  });
});

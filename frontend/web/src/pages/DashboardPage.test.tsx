// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { getCatalogosSuscripciones, getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { AuthProvider } from '../context/AuthContext';
import { CatalogosProvider } from '../context/CatalogosContext';
import { ToastProvider } from '../context/ToastContext';
import { descargarSuscripcionesCsv } from '../utils/exportarCsv';
import { DashboardPage } from './DashboardPage';
import { TileCategorias } from '../components/Dashboard/TileCategorias';

vi.mock('@ojoalgasto/shared', async (original) => ({
  ...await original<typeof import('@ojoalgasto/shared')>(),
  getSuscripciones: vi.fn(), getCatalogosSuscripciones: vi.fn(),
}));
vi.mock('../utils/exportarCsv', () => ({ descargarSuscripcionesCsv: vi.fn() }));
vi.mock('../hooks/useConteo', () => ({ useConteo: (n: number) => n }));
afterEach(cleanup);

it('incluye todas las categorías en el total aunque el gráfico muestre seis', async () => {
  vi.mocked(getCatalogosSuscripciones).mockRejectedValue(new Error('sin red'));
  const suscripciones: Suscripcion[] = Array.from({ length: 7 }, (_, i) => ({
    id: String(i), nombre: `Servicio ${i}`, categoria: `categoria_${i}`,
    monto: 1.25, moneda: 'EUR', frecuencia: 'mensual', estado: 'activo',
    fecha_proximo_cobro: '2026-11-10',
  }));
  render(<CatalogosProvider><TileCategorias suscripciones={suscripciones} moneda="EUR" /></CatalogosProvider>);
  const region = await screen.findByRole('region', { name: 'Gasto por categoría' });
  expect(region).toHaveTextContent('8,75');
  expect(region).toHaveTextContent('en 7 categorías');
  expect(within(region).getByRole('img').getAttribute('aria-label')?.split(', ')).toHaveLength(6);
});

it('filtra todas las cifras, categorías y CSV por la moneda elegida, incluso sin catálogo', async () => {
  const base: Suscripcion = { id: 'clp', nombre: 'Pesos', monto: 10000, moneda: 'CLP',
    frecuencia: 'mensual', fecha_proximo_cobro: '2026-11-10', categoria: 'otro', estado: 'activo' };
  const euro: Suscripcion = { ...base, id: 'eur', nombre: 'Euros', moneda: 'EUR', monto: 4.99 };
  const dolar: Suscripcion = { ...base, id: 'usd', nombre: 'Dólares', moneda: 'USD', monto: 2.25, estado: 'fantasma' };
  vi.mocked(getSuscripciones).mockResolvedValue([base, euro, dolar]);
  vi.mocked(getCatalogosSuscripciones).mockRejectedValue(new Error('sin red'));
  render(<MemoryRouter><ToastProvider><AuthProvider><CatalogosProvider>
    <DashboardPage />
  </CatalogosProvider></AuthProvider></ToastProvider></MemoryRouter>);
  const selector = await screen.findByRole('combobox', { name: 'Moneda del panel' });
  expect(selector).toHaveValue('CLP');
  expect(screen.getByRole('region', { name: 'Resumen del mes' })).toHaveTextContent('$10.000');
  fireEvent.change(selector, { target: { value: 'EUR' } });
  const resumen = screen.getByRole('region', { name: 'Resumen del mes' });
  expect(resumen).toHaveTextContent('4,99');
  expect(resumen).not.toHaveTextContent('10.000');
  expect(screen.getByRole('region', { name: 'Gasto por categoría' })).toHaveTextContent('4,99');
  expect(within(screen.getByRole('region', { name: 'Tus suscripciones más grandes' })).queryByText('Pesos')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
  expect(descargarSuscripcionesCsv).toHaveBeenCalledWith([euro], 'suscripciones-EUR.csv', undefined);
  fireEvent.change(selector, { target: { value: 'USD' } });
  expect(screen.getByRole('region', { name: 'Salud del gasto' })).toHaveTextContent('US$2,25');
});

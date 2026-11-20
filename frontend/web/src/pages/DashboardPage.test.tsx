// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getCatalogosSuscripciones, getComparacionDePresupuesto, getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { AuthProvider } from '../context/AuthContext';
import { CatalogosProvider } from '../context/CatalogosContext';
import { ToastProvider } from '../context/ToastContext';
import { descargarSuscripcionesCsv } from '../utils/exportarCsv';
import { DashboardPage } from './DashboardPage';
import { TileCategorias } from '../components/Dashboard/TileCategorias';

vi.mock('@ojoalgasto/shared', async (original) => ({
  ...await original<typeof import('@ojoalgasto/shared')>(),
  getSuscripciones: vi.fn(), getCatalogosSuscripciones: vi.fn(), getComparacionDePresupuesto: vi.fn(),
}));
vi.mock('../utils/exportarCsv', () => ({ descargarSuscripcionesCsv: vi.fn() }));
vi.mock('../hooks/useConteo', () => ({ useConteo: (n: number) => n }));
afterEach(cleanup);
// Sin esto el presupuesto del Panel pediría de verdad a la API, que en las pruebas no existe.
beforeEach(() => {
  vi.mocked(getComparacionDePresupuesto).mockReset().mockImplementation(async (mes, moneda) => ({
    mes, moneda, presupuesto: null, gasto_real: '0.00', gasto_proyectado: '0.00', total_esperado: '0.00',
    diferencia: null, porcentaje_consumido: 0, alerta_superado: false,
  }));
});

it.each([
  ['EUR', 5.03, 'anual', 6, '2,52'],
  ['CLP', 5.94, 'anual', 1, '$0'],
  ['EUR', 0.01, 'anual', 12, '0,01'],
  ['EUR', 0.10, 'mensual', 3, '0,30'],
] as const)('proyecta %s %s %s sin redondear antes de sumar', async (moneda, monto, frecuencia, cantidad, esperado) => {
  const suscripciones: Suscripcion[] = Array.from({ length: cantidad }, (_, i) => ({
    id: String(i), nombre: `Servicio ${i}`, categoria: 'otro',
    monto, moneda, frecuencia, estado: 'fantasma', fecha_proximo_cobro: '2026-11-10',
  }));
  vi.mocked(getSuscripciones).mockResolvedValue(suscripciones);
  vi.mocked(getCatalogosSuscripciones).mockRejectedValue(new Error('sin red'));
  render(<MemoryRouter><ToastProvider><AuthProvider><CatalogosProvider>
    <DashboardPage />
  </CatalogosProvider></AuthProvider></ToastProvider></MemoryRouter>);
  const resumen = await screen.findByRole('region', { name: 'Resumen del mes' });
  expect(resumen).toHaveTextContent(`${esperado}al mes`);
  expect(within(resumen).getByText('Sin uso').parentElement).toHaveTextContent(esperado);
  const salud = screen.getByRole('region', { name: 'Salud del gasto' });
  expect(within(salud).getByText('Sin uso').parentElement).toHaveTextContent(esperado);
  // Incluso si CLP se presenta como $0, el gasto existe y es totalmente sin uso.
  expect(within(salud).getByRole('img')).toHaveAttribute('aria-label', '0 % del gasto en uso');
  const categorias = screen.getByRole('region', { name: 'Gasto por categoría' });
  expect(categorias).toHaveTextContent(esperado);
  expect(within(categorias).getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining(esperado));
  // El hub muestra como máximo seis; doce anuales de 0,01 dejan 0,005 visibles.
  const visible = cantidad === 12 ? '0,01' : esperado;
  expect(screen.getByRole('region', { name: 'Tus suscripciones más grandes' })).toHaveTextContent(`${visible} al mes`);
});

it('suma el total antes de redondear los subtotales de categorías', async () => {
  const suscripciones: Suscripcion[] = Array.from({ length: 6 }, (_, i) => ({
    id: String(i), nombre: `Servicio ${i}`, categoria: i < 3 ? 'uno' : 'dos',
    monto: 0.02, moneda: 'EUR', frecuencia: 'anual', estado: 'activo', fecha_proximo_cobro: '2026-11-10',
  }));
  vi.mocked(getCatalogosSuscripciones).mockRejectedValue(new Error('sin red'));
  render(<CatalogosProvider><TileCategorias suscripciones={suscripciones} moneda="EUR" /></CatalogosProvider>);
  const region = await screen.findByRole('region', { name: 'Gasto por categoría' });
  expect(region).toHaveTextContent('0,01en 2 categorías');
  expect(within(region).getByRole('img').getAttribute('aria-label')?.replace(/\s/g, ' ')).toBe('uno EUR 0,01, dos EUR 0,01');
});

it('conserva los estados propios de resumen, salud, categorías y las más grandes', async () => {
  const base: Suscripcion = { id: 'activa', nombre: 'Activa', categoria: 'otro',
    monto: 1, moneda: 'EUR', frecuencia: 'mensual', estado: 'activo', fecha_proximo_cobro: '2026-11-10' };
  vi.mocked(getSuscripciones).mockResolvedValue([
    base,
    { ...base, id: 'fantasma', estado: 'fantasma', monto: 0.12, frecuencia: 'anual' },
    { ...base, id: 'prueba', estado: 'prueba', monto: 12, fin_prueba: '2026-11-10' },
    { ...base, id: 'sin-fecha', estado: 'prueba', monto: 4 },
    { ...base, id: 'pendiente', estado: 'por_confirmar', monto: 5 },
    { ...base, id: 'cancelada', estado: 'cancelado', monto: 100 },
  ]);
  vi.mocked(getCatalogosSuscripciones).mockRejectedValue(new Error('sin red'));
  render(<MemoryRouter><ToastProvider><AuthProvider><CatalogosProvider>
    <DashboardPage />
  </CatalogosProvider></AuthProvider></ToastProvider></MemoryRouter>);
  const resumen = await screen.findByRole('region', { name: 'Resumen del mes' });
  expect(resumen).toHaveTextContent('13,01al mes');
  expect(resumen).toHaveTextContent('2 suscripciones activas');
  const salud = screen.getByRole('region', { name: 'Salud del gasto' });
  expect(within(salud).getByRole('img')).toHaveAttribute('aria-label', '99 % del gasto en uso');
  expect(within(salud).getByText('Sin uso').parentElement).toHaveTextContent('0,01');
  expect(within(salud).getByText('Pruebas gratis').parentElement).toHaveTextContent('2');
  expect(screen.getByRole('region', { name: 'Gasto por categoría' })).toHaveTextContent('1,01en 1 categoría');
  expect(screen.getByRole('region', { name: 'Tus suscripciones más grandes' })).toHaveTextContent('22,01 al mes');
});

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

function UbicacionActual() {
  const ubicacion = useLocation();
  return <p data-testid="ubicacion">{`${ubicacion.pathname}${ubicacion.search}`}</p>;
}

const suscripcionesEnDosMonedas: Suscripcion[] = [
  { id: 'clp', nombre: 'Pesos', monto: 10000, moneda: 'CLP', frecuencia: 'mensual', fecha_proximo_cobro: '2026-11-10', categoria: 'otro', estado: 'activo' },
  { id: 'eur', nombre: 'Euros', monto: 4.99, moneda: 'EUR', frecuencia: 'mensual', fecha_proximo_cobro: '2026-11-10', categoria: 'otro', estado: 'activo' },
];

function montarElPanel(url: string) {
  vi.mocked(getSuscripciones).mockResolvedValue(suscripcionesEnDosMonedas);
  vi.mocked(getCatalogosSuscripciones).mockRejectedValue(new Error('sin red'));
  return render(<MemoryRouter initialEntries={[url]}><ToastProvider><AuthProvider><CatalogosProvider>
    <DashboardPage />
    <UbicacionActual />
  </CatalogosProvider></AuthProvider></ToastProvider></MemoryRouter>);
}

it('el Panel trae la sección de presupuesto, y pide el presupuesto del mes de la URL en la moneda del Panel (S3-CH-27)', async () => {
  montarElPanel('/dashboard?mes=2026-11');

  const presupuesto = await screen.findByRole('region', { name: 'Presupuesto del mes' });
  expect(await within(presupuesto).findByText('Aún no defines un presupuesto para noviembre de 2026 en CLP.')).toBeInTheDocument();
  expect(getComparacionDePresupuesto).toHaveBeenCalledWith('2026-11', 'CLP');
});

it('la moneda del Panel queda en la URL, y el presupuesto la sigue sin mezclar monedas (S3-CH-27)', async () => {
  montarElPanel('/dashboard?mes=2026-11');
  const selector = await screen.findByRole('combobox', { name: 'Moneda del panel' });

  fireEvent.change(selector, { target: { value: 'EUR' } });

  const presupuesto = screen.getByRole('region', { name: 'Presupuesto del mes' });
  expect(await within(presupuesto).findByText('Aún no defines un presupuesto para noviembre de 2026 en EUR.')).toBeInTheDocument();
  expect(getComparacionDePresupuesto).toHaveBeenLastCalledWith('2026-11', 'EUR');
  const parametros = new URLSearchParams(screen.getByTestId('ubicacion').textContent!.split('?')[1]);
  expect(parametros.get('moneda')).toBe('EUR');
  expect(parametros.get('mes')).toBe('2026-11');
});

it('al recargar con ?moneda= el Panel se queda en esa moneda, y el presupuesto también (S3-CH-27)', async () => {
  montarElPanel('/dashboard?moneda=EUR&mes=2026-10');

  const selector = await screen.findByRole('combobox', { name: 'Moneda del panel' });
  expect(selector).toHaveValue('EUR');
  const presupuesto = screen.getByRole('region', { name: 'Presupuesto del mes' });
  expect(await within(presupuesto).findByText('Aún no defines un presupuesto para octubre de 2026 en EUR.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Resumen del mes' })).toHaveTextContent('4,99');
});

it('una moneda de la URL que el Panel no tiene se ignora: se usa la de siempre y no se pide el presupuesto en esa moneda (S3-CH-27)', async () => {
  montarElPanel('/dashboard?moneda=XXX&mes=2026-11');

  const selector = await screen.findByRole('combobox', { name: 'Moneda del panel' });
  expect(selector).toHaveValue('CLP');
  await screen.findByText('Aún no defines un presupuesto para noviembre de 2026 en CLP.');
  expect(vi.mocked(getComparacionDePresupuesto).mock.calls.map(([, moneda]) => moneda)).not.toContain('XXX');
});

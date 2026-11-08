// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalogosSuscripciones, type CatalogosSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { CatalogosProvider } from '../../context/CatalogosContext';
import NuevaSuscripcionForm from './NuevaSuscripcionForm';
import EditarSuscripcionForm, { aFormulario } from './EditarSuscripcionForm';
import TarjetaSuscripcion from './TarjetaSuscripcion';
import { TileCategorias } from '../Dashboard/TileCategorias';
import { TileHub } from '../Dashboard/TileHub';

vi.mock('@ojoalgasto/shared', async (original) => ({
  ...await original<typeof import('@ojoalgasto/shared')>(), getCatalogosSuscripciones: vi.fn(),
}));

const opcion = (codigo: string, nombre: string, activo = true) => ({ codigo, nombre, activo, orden: 1 });
const datos: CatalogosSuscripciones = {
  monedas: [opcion('CLP', 'Peso chileno'), opcion('USD', 'Dólar')],
  categorias: [opcion('otro', 'Otro'), opcion('hogar', 'Casa y hogar'), opcion('legacy', 'Histórica', false)],
  frecuencias: [{ codigo: 'mensual', nombre: 'Mensual' }, { codigo: 'anual', nombre: 'Anual' }],
  predeterminados: { moneda: 'CLP', categoria: 'otro', frecuencia: 'mensual' },
};
const sub: Suscripcion = { id: 's1', nombre: 'Servicio nuevo', monto: 100, moneda: 'CLP', frecuencia: 'mensual',
  categoria: 'hogar', estado: 'activo', fecha_proximo_cobro: '2026-11-20' };

beforeEach(() => vi.mocked(getCatalogosSuscripciones).mockReset().mockResolvedValue(structuredClone(datos)));
afterEach(cleanup);
function montar(children: React.ReactNode) {
  return render(<MemoryRouter><CatalogosProvider>{children}</CatalogosProvider></MemoryRouter>);
}

describe('formularios con catálogos', () => {
  it('bloquea durante carga y guarda una categoría nueva entregada por la API', async () => {
    const guardar = vi.fn().mockResolvedValue(false);
    montar(<NuevaSuscripcionForm onAdd={guardar} />);
    expect(screen.getByRole('button', { name: 'Guardar suscripción' })).toBeDisabled();
    await screen.findByRole('option', { name: 'Casa y hogar' });
    expect(screen.queryByRole('option', { name: 'Histórica' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'Mi servicio' } });
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'hogar' } });
    fireEvent.change(screen.getByLabelText('Próximo cobro'), { target: { value: '2026-11-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar suscripción' }));
    await waitFor(() => expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ categoria: 'hogar', moneda: 'CLP' })));
    expect(screen.getByLabelText('Servicio')).toHaveValue('Mi servicio');
  });

  it('conserva lo escrito si falla una recarga y permite reintentar', async () => {
    montar(<NuevaSuscripcionForm />);
    await screen.findByRole('option', { name: 'Casa y hogar' });
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'Sin perder' } });
    vi.mocked(getCatalogosSuscripciones).mockRejectedValueOnce(new Error('sin red'));
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar opciones' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Servicio')).toHaveValue('Sin perder');
    expect(screen.getByRole('button', { name: 'Guardar suscripción' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar opciones' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar suscripción' })).toBeEnabled());
    expect(screen.getByLabelText('Servicio')).toHaveValue('Sin perder');
  });

  it('una lista vacía no permite enviar ni inventa opciones', async () => {
    vi.mocked(getCatalogosSuscripciones).mockResolvedValue({ ...datos, monedas: [], predeterminados: { ...datos.predeterminados, moneda: null } });
    montar(<NuevaSuscripcionForm />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay opciones');
    expect(screen.getByRole('button', { name: 'Guardar suscripción' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: /Peso chileno/ })).not.toBeInTheDocument();
  });

  it('permite editar históricos aunque todas las opciones estén inactivas', async () => {
    vi.mocked(getCatalogosSuscripciones).mockResolvedValue({ ...datos,
      monedas: datos.monedas.map((o) => ({ ...o, activo: false })),
      categorias: datos.categorias.map((o) => ({ ...o, activo: false })),
    });
    const guardar = vi.fn();
    montar(<EditarSuscripcionForm suscripcion={aFormulario({ ...sub, categoria: 'legacy' })} onSubmit={guardar} />);
    await screen.findByRole('option', { name: 'Histórica (inactiva)' });
    expect(screen.queryByRole('option', { name: 'Casa y hogar (inactiva)' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'Renombrado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ categoria: 'legacy', nombre: 'Renombrado' }));
  });

  it('bloquea una categoría que se desactiva mientras se edita', async () => {
    montar(<NuevaSuscripcionForm />);
    await screen.findByRole('option', { name: 'Casa y hogar' });
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'hogar' } });
    vi.mocked(getCatalogosSuscripciones).mockResolvedValueOnce({ ...datos, categorias: datos.categorias.map((o) => ({ ...o, activo: o.codigo !== 'hogar' })) });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar opciones' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Guardar suscripción' })).toBeDisabled();
  });

  it('una categoría nueva aparece en tarjetas, gráfico y pestañas con su etiqueta de BD', async () => {
    montar(<><ul><TarjetaSuscripcion suscripcion={sub} /></ul><TileCategorias suscripciones={[sub]} moneda={sub.moneda} /><TileHub suscripciones={[sub]} moneda={sub.moneda} alExportar={() => {}} /></>);
    await screen.findByRole('tab', { name: 'Casa y hogar' });
    expect(screen.getAllByText('Casa y hogar').length).toBeGreaterThanOrEqual(3);
    expect(getCatalogosSuscripciones).toHaveBeenCalledTimes(1);
  });

  it('tolera códigos que coinciden con propiedades de JavaScript o la pestaña Todas', async () => {
    vi.mocked(getCatalogosSuscripciones).mockResolvedValue({ ...datos,
      categorias: [opcion('constructor', 'Construcción'), opcion('todas', 'Servicios de casa')],
    });
    const suscripciones = [{ ...sub, categoria: 'constructor' }, { ...sub, id: 's2', categoria: 'todas', nombre: 'Otra' }];
    montar(<><ul><TarjetaSuscripcion suscripcion={suscripciones[0]} /></ul><TileHub suscripciones={suscripciones} moneda={sub.moneda} alExportar={() => {}} /></>);
    await screen.findByRole('tab', { name: 'Construcción' });
    fireEvent.click(screen.getByRole('tab', { name: 'Servicios de casa' }));
    expect(screen.getByRole('tab', { name: 'Todas' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Servicios de casa' })).toHaveAttribute('aria-selected', 'true');
  });
});

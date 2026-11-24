// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorDeApi,
  formatearMonto,
  getComparacionDePresupuesto,
  guardarPresupuesto,
  type ComparacionDePresupuesto,
} from '@ojoalgasto/shared';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { MENSAJE_ERROR_AL_CARGAR_PRESUPUESTO, MENSAJE_SIN_PERMISO_PARA_GUARDAR } from '../../hooks/usePresupuestoMensual';
import { MENSAJE_MONTO_NO_POSITIVO, MENSAJE_MONTO_VACIO } from './montoDePresupuesto';
import { SeccionPresupuesto } from './SeccionPresupuesto';

vi.mock('@ojoalgasto/shared', async (original) => ({
  ...(await original<typeof import('@ojoalgasto/shared')>()),
  getComparacionDePresupuesto: vi.fn(),
  guardarPresupuesto: vi.fn(),
}));

const GASTO_REAL = 120000;
const GASTO_PROYECTADO = 45000;

/** El servidor de mentira: guarda presupuestos por mes y moneda y responde como VI-05. */
const presupuestosGuardados = new Map<string, number>();
const clave = (mes: string, moneda: string) => `${mes}|${moneda}`;
const texto = (monto: number) => monto.toFixed(2);

function comparacionDelServidor(mes: string, moneda: string): ComparacionDePresupuesto {
  const total = GASTO_REAL + GASTO_PROYECTADO;
  const presupuesto = presupuestosGuardados.get(clave(mes, moneda));
  return {
    mes,
    moneda,
    presupuesto: presupuesto === undefined ? null : texto(presupuesto),
    gasto_real: texto(GASTO_REAL),
    gasto_proyectado: texto(GASTO_PROYECTADO),
    total_esperado: texto(total),
    diferencia: presupuesto === undefined ? null : texto(presupuesto - total),
    porcentaje_consumido: presupuesto === undefined ? 0 : Math.round((total / presupuesto) * 10000) / 100,
    alerta_superado: presupuesto !== undefined && total > presupuesto,
  };
}

function Ubicacion() {
  const ubicacion = useLocation();
  return <p data-testid="ubicacion">{`${ubicacion.pathname}${ubicacion.search}`}</p>;
}

const arbol = (url: string, moneda: string) => (
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <AuthProvider>
        <SeccionPresupuesto moneda={moneda} />
        <Ubicacion />
      </AuthProvider>
    </ToastProvider>
  </MemoryRouter>
);
const montar = (url = '/dashboard?mes=2026-11', moneda = 'CLP') => render(arbol(url, moneda));

const seccion = () => screen.getByRole('region', { name: 'Presupuesto del mes' });
const cifra = (titulo: string) => within(seccion()).getByText(titulo).parentElement as HTMLElement;
const campoDelMonto = () => screen.getByRole('textbox', { name: /^Presupuesto de/ });
const ubicacionActual = () => screen.getByTestId('ubicacion').textContent;
const consultasHechas = () => vi.mocked(getComparacionDePresupuesto).mock.calls;

beforeEach(() => {
  presupuestosGuardados.clear();
  vi.mocked(getComparacionDePresupuesto).mockReset().mockImplementation(async (mes, moneda) => comparacionDelServidor(mes, moneda));
  vi.mocked(guardarPresupuesto).mockReset().mockImplementation(async ({ mes, moneda, monto }) => {
    presupuestosGuardados.set(clave(mes, moneda), Number(monto));
    return { id: 'p-1', mes, moneda, monto: texto(Number(monto)), creado_en: '2026-11-18T12:00:00-03:00', actualizado_en: '2026-11-18T12:00:00-03:00' };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('leer el presupuesto del mes (S3-CH-27)', () => {
  it('pide al servidor el mes de la URL y la moneda del Panel, y dice de cuál es', async () => {
    montar('/dashboard?mes=2026-11', 'CLP');

    expect(await screen.findByText('Aún no defines un presupuesto para noviembre de 2026 en CLP.')).toBeInTheDocument();
    expect(consultasHechas()).toEqual([['2026-11', 'CLP']]);
    expect(within(seccion()).getByText('Noviembre de 2026')).toBeInTheDocument();
    expect(within(seccion()).getByText('Lo que esperas gastar, en CLP')).toBeInTheDocument();
  });

  it('sin ?mes= en la URL muestra el mes de hoy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 2, 9));

    montar('/dashboard');

    await screen.findByText('Aún no defines un presupuesto para marzo de 2027 en CLP.');
    expect(consultasHechas()).toEqual([['2027-03', 'CLP']]);
  });

  it('con un ?mes= mal escrito no se lo pide al servidor: muestra el mes de hoy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 2, 9));

    montar('/dashboard?mes=2026-13');

    await screen.findByText('Aún no defines un presupuesto para marzo de 2027 en CLP.');
    expect(consultasHechas()).toEqual([['2027-03', 'CLP']]);
  });

  it('con presupuesto y dentro de él, muestra lo que dice el servidor: monto, porcentaje y lo que queda', async () => {
    presupuestosGuardados.set('2026-11|CLP', 200000);

    montar();

    expect(await screen.findByText(formatearMonto(200000, 'CLP'))).toBeInTheDocument();
    expect(within(seccion()).getByText('82,5 % del presupuesto')).toBeInTheDocument();
    expect(within(seccion()).getByText(`Te quedan ${formatearMonto(35000, 'CLP')} del presupuesto.`)).toBeInTheDocument();
    expect(within(seccion()).queryByText(/superas/i)).toBeNull();
    const barra = within(seccion()).getByRole('progressbar', { name: 'Presupuesto consumido' });
    expect(barra).toHaveAttribute('aria-valuenow', '83');
    expect(barra).toHaveAttribute('aria-valuetext', '82,5 % del presupuesto');
    expect(barra.firstElementChild).toHaveStyle({ width: '82.5%' });
    expect(cifra('Gasto real')).toHaveTextContent(formatearMonto(GASTO_REAL, 'CLP'));
    expect(cifra('Gasto proyectado')).toHaveTextContent(formatearMonto(GASTO_PROYECTADO, 'CLP'));
    expect(cifra('Total esperado')).toHaveTextContent(formatearMonto(GASTO_REAL + GASTO_PROYECTADO, 'CLP'));
  });

  it('si el servidor marca que se superó, lo avisa con lo que se pasa, y la barra no se sale de su caja', async () => {
    presupuestosGuardados.set('2026-11|CLP', 150000);

    montar();

    expect(await screen.findByText(`Entre lo cobrado y lo que falta por cobrar, superas el presupuesto por ${formatearMonto(15000, 'CLP')}.`)).toBeInTheDocument();
    expect(within(seccion()).getByText('110 % del presupuesto')).toBeInTheDocument();
    expect(within(seccion()).queryByText(/Te quedan/)).toBeNull();
    const barra = within(seccion()).getByRole('progressbar');
    expect(barra).toHaveAttribute('aria-valuenow', '100');
    expect(barra).toHaveAttribute('aria-valuetext', '110 % del presupuesto');
    expect(barra.firstElementChild).toHaveStyle({ width: '100%' });
  });

  it('el aviso es el del servidor, no una cuenta de la web: con la alerta apagada no se avisa aunque las cifras parezcan pasarse', async () => {
    vi.mocked(getComparacionDePresupuesto).mockResolvedValue({
      ...comparacionDelServidor('2026-11', 'CLP'),
      presupuesto: '100000.00',
      diferencia: '-65000.00',
      porcentaje_consumido: 165,
      alerta_superado: false,
    });

    montar();

    expect(await screen.findByText(`Te quedan ${formatearMonto(-65000, 'CLP')} del presupuesto.`)).toBeInTheDocument();
    expect(within(seccion()).queryByText(/superas/i)).toBeNull();
  });

  it('si el servidor manda presupuesto pero no la diferencia, no inventa lo que queda ni lo que se pasa', async () => {
    vi.mocked(getComparacionDePresupuesto).mockResolvedValue({
      ...comparacionDelServidor('2026-11', 'CLP'),
      presupuesto: '200000.00',
      diferencia: null,
      porcentaje_consumido: 82.5,
      alerta_superado: false,
    });

    montar();

    expect(await screen.findByText('82,5 % del presupuesto')).toBeInTheDocument();
    expect(within(seccion()).queryByText(/Te quedan/)).toBeNull();
    expect(within(seccion()).queryByText(/superas/i)).toBeNull();
  });

  it('sin presupuesto, dice que no hay uno: muestra el gasto, pero ni barra ni porcentaje ni «te quedan»', async () => {
    montar();

    expect(await screen.findByText('Aún no defines un presupuesto para noviembre de 2026 en CLP.')).toBeInTheDocument();
    expect(cifra('Gasto real')).toHaveTextContent(formatearMonto(GASTO_REAL, 'CLP'));
    expect(within(seccion()).queryByRole('progressbar')).toBeNull();
    expect(within(seccion()).queryByText(/% del presupuesto/)).toBeNull();
    expect(within(seccion()).queryByText(/Te quedan/)).toBeNull();
    expect(within(seccion()).queryByText(/de presupuesto$/)).toBeNull();
    expect(within(seccion()).getByRole('button', { name: 'Definir presupuesto' })).toBeInTheDocument();
  });

  it('con un gasto de cero y presupuesto, lo dice como un gasto de cero: no es un error ni «sin presupuesto»', async () => {
    presupuestosGuardados.set('2026-11|CLP', 200000);
    vi.mocked(getComparacionDePresupuesto).mockResolvedValue({
      ...comparacionDelServidor('2026-11', 'CLP'),
      presupuesto: '200000.00',
      gasto_real: '0.00',
      gasto_proyectado: '0.00',
      total_esperado: '0.00',
      diferencia: '200000.00',
      porcentaje_consumido: 0,
      alerta_superado: false,
    });

    montar();

    expect(await screen.findByText('Sin gasto en noviembre de 2026: no hay cobros ni cobros por venir en CLP.')).toBeInTheDocument();
    expect(cifra('Gasto real')).toHaveTextContent(formatearMonto(0, 'CLP'));
    expect(within(seccion()).getByText('0 % del presupuesto')).toBeInTheDocument();
    expect(within(seccion()).getByText(`Te quedan ${formatearMonto(200000, 'CLP')} del presupuesto.`)).toBeInTheDocument();
    expect(within(seccion()).queryByText(/Aún no defines/)).toBeNull();
    expect(within(seccion()).queryByRole('alert')).toBeNull();
  });

  it('un gasto con montos distintos de cero no dice «sin gasto»', async () => {
    montar();

    await screen.findByText(/Aún no defines/);

    expect(within(seccion()).queryByText(/Sin gasto en/)).toBeNull();
  });

  it('con un error de consulta lo dice: no muestra un gasto de cero ni un mes sin presupuesto, ni deja editar', async () => {
    vi.mocked(getComparacionDePresupuesto).mockRejectedValue(new ErrorDeApi('Error interno', 500));

    montar();

    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_ERROR_AL_CARGAR_PRESUPUESTO);
    expect(within(seccion()).queryByText(/Aún no defines/)).toBeNull();
    expect(within(seccion()).queryByText('Gasto real')).toBeNull();
    expect(within(seccion()).queryByText(formatearMonto(0, 'CLP'))).toBeNull();
    expect(within(seccion()).queryByRole('button', { name: /presupuesto$/ })).toBeNull();
  });

  it('el error de consulta se reintenta y, si responde, muestra el presupuesto', async () => {
    presupuestosGuardados.set('2026-11|CLP', 200000);
    vi.mocked(getComparacionDePresupuesto).mockRejectedValueOnce(new ErrorDeApi('Error interno', 500));
    montar();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText(formatearMonto(200000, 'CLP'))).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('mientras carga muestra un estado de carga y no cifras', async () => {
    vi.mocked(getComparacionDePresupuesto).mockImplementation(() => new Promise(() => {}));

    montar();

    expect(within(seccion()).getByLabelText('Cargando el presupuesto')).toHaveAttribute('aria-busy', 'true');
    expect(within(seccion()).queryByText('Gasto real')).toBeNull();
    expect(within(seccion()).queryByRole('button', { name: /presupuesto$/ })).toBeNull();
  });
});

describe('cambiar de mes y de moneda (S3-CH-27)', () => {
  it('las flechas cambian el mes en la URL y piden ese mes; y «Volver» regresa al mes de hoy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18));
    montar('/dashboard');
    await screen.findByText(/Aún no defines/);
    expect(within(seccion()).queryByRole('button', { name: /^Volver a/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente: diciembre de 2026' }));

    await screen.findByText('Aún no defines un presupuesto para diciembre de 2026 en CLP.');
    expect(ubicacionActual()).toBe('/dashboard?mes=2026-12');
    expect(consultasHechas().at(-1)).toEqual(['2026-12', 'CLP']);

    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior: noviembre de 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior: octubre de 2026' }));
    await screen.findByText('Aún no defines un presupuesto para octubre de 2026 en CLP.');
    expect(ubicacionActual()).toBe('/dashboard?mes=2026-10');

    fireEvent.click(screen.getByRole('button', { name: 'Volver a noviembre de 2026' }));
    await screen.findByText('Aún no defines un presupuesto para noviembre de 2026 en CLP.');
    expect(ubicacionActual()).toBe('/dashboard?mes=2026-11');
  });

  it('cambiar el mes conserva los demás filtros de la URL, como la moneda', async () => {
    montar('/dashboard?moneda=USD&mes=2026-11', 'USD');
    await screen.findByText(/Aún no defines/);

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente: diciembre de 2026' }));

    await screen.findByText('Aún no defines un presupuesto para diciembre de 2026 en USD.');
    expect(new URLSearchParams(ubicacionActual()!.split('?')[1]).get('moneda')).toBe('USD');
  });

  it('al cambiar de mes no queda a la vista el presupuesto del mes anterior', async () => {
    presupuestosGuardados.set('2026-11|CLP', 200000);
    montar();
    await screen.findByText(formatearMonto(200000, 'CLP'));

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente: diciembre de 2026' }));

    expect(within(seccion()).queryByText(formatearMonto(200000, 'CLP'))).toBeNull();
    expect(await screen.findByText(/Aún no defines un presupuesto para diciembre/)).toBeInTheDocument();
  });

  it('cada moneda se mira por separado: los montos de una no aparecen en la otra', async () => {
    presupuestosGuardados.set('2026-11|CLP', 200000);
    presupuestosGuardados.set('2026-11|USD', 150);
    const { rerender } = montar('/dashboard?mes=2026-11', 'CLP');
    await screen.findByText(formatearMonto(200000, 'CLP'));

    rerender(arbol('/dashboard?mes=2026-11', 'USD'));

    expect(within(seccion()).queryByText(formatearMonto(200000, 'CLP'))).toBeNull();
    expect(await screen.findByText(formatearMonto(150, 'USD'))).toBeInTheDocument();
    expect(consultasHechas().map(([, moneda]) => moneda)).toEqual(['CLP', 'USD']);
  });
});

describe('definir y cambiar el presupuesto (S3-CH-27)', () => {
  it('«Definir presupuesto» abre el formulario vacío del mes y la moneda que se miran', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));

    expect(campoDelMonto()).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Presupuesto de noviembre de 2026 en CLP' })).toBeInTheDocument();
    expect(campoDelMonto()).toHaveFocus();
    expect(within(seccion()).queryByRole('button', { name: 'Definir presupuesto' })).toBeNull();
  });

  it('«Editar presupuesto» trae el monto guardado, tal como se escribiría', async () => {
    presupuestosGuardados.set('2026-11|CLP', 200000);
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar presupuesto' }));

    expect(campoDelMonto()).toHaveValue('200000');
  });

  it('guarda el monto con el mes y la moneda de los filtros, y después muestra lo que devuelve el servidor', async () => {
    montar('/dashboard?mes=2026-12', 'USD');
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));

    fireEvent.change(campoDelMonto(), { target: { value: '150,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(formatearMonto(150.5, 'USD'))).toBeInTheDocument();
    expect(guardarPresupuesto).toHaveBeenCalledTimes(1);
    expect(guardarPresupuesto).toHaveBeenCalledWith({ mes: '2026-12', moneda: 'USD', monto: '150.5' });
    // Se volvió a pedir la comparación: lo que se ve es lo que dice el servidor, no lo escrito.
    expect(consultasHechas().length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(`Guardamos tu presupuesto de diciembre de 2026: ${formatearMonto(150.5, 'USD')}.`)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(within(seccion()).getByRole('button', { name: 'Editar presupuesto' })).toBeInTheDocument();
  });

  it('guardar y recargar conserva el presupuesto, el mes y la moneda', async () => {
    const primera = montar('/dashboard?mes=2026-12&moneda=USD', 'USD');
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));
    fireEvent.change(campoDelMonto(), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText(formatearMonto(300, 'USD'));
    primera.unmount();

    // Recargar: una vista nueva, con la misma URL, que solo sabe lo que le dice el servidor.
    montar('/dashboard?mes=2026-12&moneda=USD', 'USD');

    expect(await screen.findByText(formatearMonto(300, 'USD'))).toBeInTheDocument();
    expect(within(seccion()).getByText('Diciembre de 2026')).toBeInTheDocument();
    expect(within(seccion()).getByText('Lo que esperas gastar, en USD')).toBeInTheDocument();
    expect(within(seccion()).queryByText(/Guardamos tu presupuesto/)).toBeNull();
  });

  it('cambiar un presupuesto ya definido lo reemplaza', async () => {
    presupuestosGuardados.set('2026-11|CLP', 200000);
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar presupuesto' }));

    fireEvent.change(campoDelMonto(), { target: { value: '150000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(formatearMonto(150000, 'CLP'))).toBeInTheDocument();
    expect(await screen.findByText(/superas el presupuesto por/)).toBeInTheDocument();
  });

  it.each([
    ['', MENSAJE_MONTO_VACIO],
    ['0', MENSAJE_MONTO_NO_POSITIVO],
    ['5.900', 'Escribe solo números, sin símbolos ni separador de miles. Por ejemplo: 200000 o 200000,50.'],
  ])('un monto «%s» no se manda: dice por qué y deja el foco en el campo', async (escrito, mensaje) => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));

    fireEvent.change(campoDelMonto(), { target: { value: escrito } });
    // Un clic de verdad deja el foco en el botón: el campo no lo conserva por casualidad.
    screen.getByRole('button', { name: 'Guardar' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(campoDelMonto()).toHaveAttribute('aria-invalid', 'true');
    expect(campoDelMonto()).toHaveFocus();
    expect(guardarPresupuesto).not.toHaveBeenCalled();
  });

  it('al corregir el monto desaparece el error de validación', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText(MENSAJE_MONTO_VACIO);

    fireEvent.change(campoDelMonto(), { target: { value: '1000' } });

    expect(screen.queryByText(MENSAJE_MONTO_VACIO)).toBeNull();
    expect(campoDelMonto()).not.toHaveAttribute('aria-invalid');
  });

  it('un monto que el servidor rechaza muestra su mensaje junto al campo y conserva lo escrito', async () => {
    vi.mocked(guardarPresupuesto).mockRejectedValue(new ErrorDeApi('x', 400, { monto: ['Asegúrese de que no haya más de 10 dígitos en total.'] }));
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));

    fireEvent.change(campoDelMonto(), { target: { value: '99999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Asegúrese de que no haya más de 10 dígitos en total.')).toBeInTheDocument();
    expect(campoDelMonto()).toHaveValue('99999999');
    expect(campoDelMonto()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('sin permiso para guardar lo dice con palabras claras', async () => {
    vi.mocked(guardarPresupuesto).mockRejectedValue(new ErrorDeApi('La cabecera X-Organizacion-Id es obligatoria.', 403));
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));

    fireEvent.change(campoDelMonto(), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(MENSAJE_SIN_PERMISO_PARA_GUARDAR)).toBeInTheDocument();
    expect(screen.queryByText(/X-Organizacion-Id/)).toBeNull();
  });

  it('mientras guarda, el formulario no se puede tocar ni mandar otra vez', async () => {
    vi.mocked(guardarPresupuesto).mockImplementation(() => new Promise(() => {}));
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));
    fireEvent.change(campoDelMonto(), { target: { value: '1000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(campoDelMonto()).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    fireEvent.submit(campoDelMonto().closest('form') as HTMLFormElement);
    expect(guardarPresupuesto).toHaveBeenCalledTimes(1);
  });

  it('cancelar cierra el formulario sin guardar', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));
    fireEvent.change(campoDelMonto(), { target: { value: '1000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(guardarPresupuesto).not.toHaveBeenCalled();
    expect(within(seccion()).getByRole('button', { name: 'Definir presupuesto' })).toBeInTheDocument();
  });

  it('si la comparación falla después de guardar, igual dice que se guardó y deja reintentar', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));
    vi.mocked(getComparacionDePresupuesto).mockRejectedValue(new ErrorDeApi('Error interno', 500));

    fireEvent.change(campoDelMonto(), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_ERROR_AL_CARGAR_PRESUPUESTO);
    expect(screen.getByText(`Guardamos tu presupuesto de noviembre de 2026: ${formatearMonto(1000, 'CLP')}.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('cambiar de mes cierra el formulario y borra el aviso de guardado', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Definir presupuesto' }));
    fireEvent.change(campoDelMonto(), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText(/Guardamos tu presupuesto/);

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente: diciembre de 2026' }));

    await screen.findByText(/Aún no defines un presupuesto para diciembre/);
    expect(screen.queryByText(/Guardamos tu presupuesto/)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

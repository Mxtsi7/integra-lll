// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenDelPeriodo } from '@ojoalgasto/shared';
import { ErrorDeApi, pedir } from '../../../shared/src/api/cliente';
import { guardarTokens } from '../../../shared/src/auth';
import { CatalogosLayout } from '../context/CatalogosContext';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { CATALOGOS_DE_PRUEBA, resumenDePrueba } from '../test/informesDePrueba';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { guardarArchivo } from '../utils/descargas';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import { MENSAJE_ERROR_DESCARGA } from '../hooks/useDescargaDeCobros';
import { MENSAJE_ERROR_INFORME } from '../hooks/useInformeMensual';
import { InformesPage } from './InformesPage';

// Estas pruebas cubren la parte de abajo de Informes: el histórico de una moneda y su descarga (S3-CH-25).
// La parte de arriba (AN-22) la prueban InformesPage.test.tsx; aquí se le da un resumen vacío.
// Solo se simula la red (pedir) y el guardado del archivo. La página, los hooks, el catálogo,
// el cliente de shared y la sesión son los reales.
vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});
vi.mock('../utils/descargas', () => ({ guardarArchivo: vi.fn() }));

const TOKEN = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };
const CSV = 'servicio,categoria,monto,moneda,fecha,origen,estado\r\nSpotify,musica,5900.00,CLP,2026-10-05,manual,activo\r\n';

/** Gasto real y proyectado por mes y moneda. Lo que no está acá es cero. */
const GASTOS: Record<string, Record<string, [string, string]>> = {
  CLP: { '2026-05': ['1000.00', '0.00'], '2026-06': ['2000.00', '0.00'], '2026-07': ['3000.00', '0.00'], '2026-08': ['4000.00', '0.00'], '2026-09': ['5000.00', '0.00'], '2026-10': ['30000.00', '10000.00'], '2026-11': ['0.00', '9000.00'] },
  USD: { '2026-09': ['2.00', '0.00'], '2026-10': ['4.50', '0.00'] },
};

interface Servidor {
  catalogos: () => Promise<unknown>;
  resumen: (mes: string, moneda: string) => Promise<unknown>;
  exportacion: (ruta: string) => Promise<unknown>;
}
let servidor: Servidor;

const resumenSegunDatos = (mes: string, moneda: string) => {
  const [real, proyectado] = GASTOS[moneda]?.[mes] ?? ['0.00', '0.00'];
  const total = (Number(real) + Number(proyectado)).toFixed(2);
  return Promise.resolve(resumenDePrueba({ periodo: mes, moneda, gasto_real: real, gasto_proyectado: proyectado, total_estimado: total }));
};

/** La parte de arriba de la página no recibe datos en estas pruebas. Función estable, como pide la página. */
const SIN_RESUMEN_DEL_PERIODO = (mes: string) =>
  Promise.resolve<ResumenDelPeriodo>({
    periodo: mes,
    conteo: { activo: 0, prueba: 0, por_confirmar: 0, cancelado: 0, fantasma: 0, total: 0 },
    gastos: [],
  });

function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((alResolver, alRechazar) => {
    resolver = alResolver;
    rechazar = alRechazar;
  });
  return { promesa, resolver, rechazar };
}

const pedidos = (prefijo: string) => vi.mocked(pedir).mock.calls.map(([ruta]) => String(ruta)).filter((ruta) => ruta.startsWith(prefijo));
const resumenesPedidos = () => pedidos('/suscripciones/resumen/');
const exportacionesPedidas = () => pedidos('/suscripciones/exportar-csv/');

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <div data-testid="ubicacion">{`${pathname}${search}`}</div>;
}

const montar = async (ruta = '/informes?mes=2026-10', estricto = false, cargarResumen = SIN_RESUMEN_DEL_PERIODO) => {
  const arbol = (
    <MemoryRouter initialEntries={[ruta]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route element={<CatalogosLayout />}>
              <Route path="/informes" element={<InformesPage cargarResumen={cargarResumen} />} />
            </Route>
          </Routes>
          <Ubicacion />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  render(estricto ? <StrictMode>{arbol}</StrictMode> : arbol);
  await act(async () => {});
};

const ubicacion = () => screen.getByTestId('ubicacion').textContent;
const titulo = () => screen.getByRole('heading', { level: 2, name: /de 20\d\d$/ });
const tablaDelHistorico = () => screen.getByRole('table', { name: 'Detalle por mes' });
const filasDelHistorico = () => within(tablaDelHistorico()).getAllByRole('row').slice(1);
const botonDescargar = () => screen.getByRole('button', { name: /^Descarg/ });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset();
  vi.mocked(guardarArchivo).mockReset();
  guardarTokens({ access_token: TOKEN, refresh_token: 'refresh-a' });
  servidor = {
    catalogos: () => Promise.resolve(CATALOGOS_DE_PRUEBA),
    resumen: resumenSegunDatos,
    exportacion: () => Promise.resolve(CSV),
  };
  vi.mocked(pedir).mockImplementation((ruta: string) => {
    if (ruta.startsWith('/catalogos/suscripciones/')) return servidor.catalogos();
    const resumen = /^\/suscripciones\/resumen\/\?mes=(\d{4}-\d{2})&moneda=([A-Za-z]+)$/.exec(ruta);
    if (resumen !== null) return servidor.resumen(resumen[1], resumen[2]);
    if (ruta.startsWith('/suscripciones/exportar-csv/')) return servidor.exportacion(ruta);
    return Promise.resolve(PERSONA_ACTUAL);
  });
  // Solo la fecha: los temporizadores siguen siendo reales.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 24, 12));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('las monedas del catálogo (S3-CH-25)', () => {
  it('mientras cargan se dice, y todavía no se pide ningún gasto', async () => {
    const catalogo = diferida<unknown>();
    servidor.catalogos = () => catalogo.promesa;

    await montar();

    expect(screen.getByRole('status', { name: 'Cargando las monedas' })).toBeInTheDocument();
    expect(resumenesPedidos()).toHaveLength(0);
    await act(async () => catalogo.resolver(CATALOGOS_DE_PRUEBA));
  });

  it('si no cargan, avisa con una alerta y Reintentar las vuelve a pedir', async () => {
    servidor.catalogos = () => Promise.reject(new ErrorDeApi('Error interno.', 500));
    await montar();

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar las opciones. Intenta de nuevo.');
    expect(resumenesPedidos()).toHaveLength(0);

    servidor.catalogos = () => Promise.resolve(CATALOGOS_DE_PRUEBA);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })));

    expect(screen.getByRole('combobox', { name: 'Moneda' })).toBeInTheDocument();
    expect(resumenesPedidos()).toHaveLength(6);
  });

  it('sin ninguna moneda activa lo dice y no pide nada', async () => {
    servidor.catalogos = () => Promise.resolve({ ...CATALOGOS_DE_PRUEBA, monedas: [{ codigo: 'EUR', nombre: 'Euro', activo: false, orden: 1 }] });

    await montar();

    expect(screen.getByText('No hay monedas disponibles para mostrar informes.')).toBeInTheDocument();
    expect(resumenesPedidos()).toHaveLength(0);
  });

  it('ofrece solo las activas, en el orden del catálogo', async () => {
    await montar();

    const opciones = Array.from(screen.getByRole('combobox', { name: 'Moneda' }).querySelectorAll('option')).map((opcion) => opcion.textContent);
    expect(opciones).toEqual(['CLP · Peso chileno', 'USD · Dólar']);
  });

  it('sin moneda en la URL usa la predeterminada del catálogo', async () => {
    await montar();

    expect(screen.getByRole('combobox', { name: 'Moneda' })).toHaveValue('CLP');
    expect(resumenesPedidos().every((ruta) => ruta.endsWith('&moneda=CLP'))).toBe(true);
  });

  it('usa la predeterminada del catálogo aunque no sea la primera de la lista', async () => {
    servidor.catalogos = () =>
      Promise.resolve({ ...CATALOGOS_DE_PRUEBA, predeterminados: { ...CATALOGOS_DE_PRUEBA.predeterminados, moneda: 'USD' } });

    await montar();

    expect(screen.getByRole('combobox', { name: 'Moneda' })).toHaveValue('USD');
    expect(resumenesPedidos().every((ruta) => ruta.endsWith('&moneda=USD'))).toBe(true);
  });

  it('una moneda de la URL que no existe no se pide: usa la predeterminada', async () => {
    await montar('/informes?mes=2026-10&moneda=XXX');

    expect(resumenesPedidos().every((ruta) => ruta.endsWith('&moneda=CLP'))).toBe(true);
  });
});

describe('el histórico de una moneda (S3-CH-25)', () => {
  it('con el mes de la URL pide ese mes y los cinco anteriores, y lo muestra como título', async () => {
    await montar('/informes?mes=2026-10');

    expect(titulo()).toHaveTextContent('Octubre de 2026');
    expect(resumenesPedidos()).toEqual([
      '/suscripciones/resumen/?mes=2026-05&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-06&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-07&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-08&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-09&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-10&moneda=CLP',
    ]);
  });

  it('sin mes en la URL usa el mes de hoy; con uno mal escrito, también: nunca se pide un mes inválido', async () => {
    await montar('/informes');
    expect(titulo()).toHaveTextContent('Octubre de 2026');
    cleanup();
    vi.mocked(pedir).mockClear();

    await montar('/informes?mes=2026-13');

    expect(titulo()).toHaveTextContent('Octubre de 2026');
    expect(resumenesPedidos().some((ruta) => ruta.includes('2026-13'))).toBe(false);
  });

  it('muestra los seis meses en la tabla, con el mes elegido marcado y sus cifras', async () => {
    await montar();

    const filas = filasDelHistorico();
    expect(filas).toHaveLength(6);
    expect(filas[5]).toHaveAttribute('aria-current', 'true');
    expect(filas[5]).toHaveTextContent('$30.000');
    expect(filas[5]).toHaveTextContent('$10.000');
    expect(filas[5]).toHaveTextContent('$40.000');
    expect(filas[0]).toHaveTextContent('Mayo de 2026');
    expect(filas[0]).toHaveTextContent('$1.000');
  });

  it('mientras carga lo dice y no muestra la tabla', async () => {
    const lento = diferida<unknown>();
    servidor.resumen = () => lento.promesa;

    await montar();

    expect(screen.getByRole('status', { name: 'Cargando tus gastos' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Detalle por mes' })).not.toBeInTheDocument();
    await act(async () => lento.resolver(resumenDePrueba()));
  });

  it('con error lo anuncia, y Reintentar vuelve a pedir y muestra el histórico', async () => {
    servidor.resumen = (mes, moneda) => (mes === '2026-07' ? Promise.reject(new ErrorDeApi('Error interno.', 500)) : resumenSegunDatos(mes, moneda));
    await montar();

    expect(screen.getByRole('alert')).toHaveTextContent(MENSAJE_ERROR_INFORME);
    expect(screen.queryByRole('table', { name: 'Detalle por mes' })).not.toBeInTheDocument();

    servidor.resumen = resumenSegunDatos;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })));

    expect(tablaDelHistorico()).toHaveTextContent('$30.000');
  });

  it('sin red dice que no hay conexión', async () => {
    servidor.resumen = () => Promise.reject(new TypeError('Failed to fetch'));

    await montar();

    expect(screen.getByRole('alert')).toHaveTextContent(MENSAJE_SIN_RED);
  });

  it('sin un solo cobro en esa moneda dice que no hay, sin tabla ni descarga', async () => {
    servidor.resumen = (mes, moneda) => Promise.resolve(resumenDePrueba({ periodo: mes, moneda, gasto_real: '0.00', gasto_proyectado: '0.00', total_estimado: '0.00' }));

    await montar();

    expect(screen.getByText(/No hay cobros en CLP en los últimos 6 meses/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Detalle por mes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Descarg/ })).not.toBeInTheDocument();
  });

  it('en modo estricto, que repite los efectos, termina mostrando el histórico', async () => {
    await montar('/informes?mes=2026-10', true);

    expect(tablaDelHistorico()).toHaveTextContent('$30.000');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('«Gastado» dice que solo cuenta las suscripciones activas, y la descarga avisa que trae también las eliminadas', async () => {
    const conGastos: ResumenDelPeriodo = {
      periodo: '2026-10',
      conteo: { activo: 1, prueba: 0, por_confirmar: 0, cancelado: 0, fantasma: 0, total: 1 },
      gastos: [{ moneda: 'CLP', gastoReal: 30000, gastoProyectado: 10000, totalEstimado: 40000 }],
    };
    await montar('/informes?mes=2026-10', false, vi.fn().mockResolvedValue(conGastos));

    expect(screen.getByText('«Gastado» cuenta solo los cobros de suscripciones que siguen activas.')).toBeInTheDocument();
    expect(screen.getByText(/Incluye también los de suscripciones que eliminaste/)).toBeInTheDocument();
  });
});

describe('cambiar de mes y de moneda (S3-CH-25)', () => {
  it('la flecha siguiente pasa al mes siguiente: lo pone en la URL y pide los seis meses que terminan ahí', async () => {
    await montar('/informes?mes=2026-09');
    vi.mocked(pedir).mockClear();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' })));

    expect(titulo()).toHaveTextContent('Octubre de 2026');
    expect(ubicacion()).toContain('mes=2026-10');
    expect(resumenesPedidos().at(0)).toBe('/suscripciones/resumen/?mes=2026-05&moneda=CLP');
    expect(resumenesPedidos().at(-1)).toBe('/suscripciones/resumen/?mes=2026-10&moneda=CLP');
    expect(filasDelHistorico()[5]).toHaveAttribute('aria-current', 'true');
  });

  it('«Este mes» vuelve al mes de hoy desde otro mes', async () => {
    await montar('/informes?mes=2026-03');
    expect(titulo()).toHaveTextContent('Marzo de 2026');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Este mes' })));

    expect(titulo()).toHaveTextContent('Octubre de 2026');
    expect(ubicacion()).toContain('mes=2026-10');
  });

  it('cambiar de moneda la pone en la URL, conserva el mes y pide todo de nuevo en esa moneda', async () => {
    await montar('/informes?mes=2026-10');
    vi.mocked(pedir).mockClear();

    await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'Moneda' }), { target: { value: 'USD' } }));

    expect(ubicacion()).toContain('moneda=USD');
    expect(ubicacion()).toContain('mes=2026-10');
    expect(resumenesPedidos()).toHaveLength(6);
    expect(resumenesPedidos().every((ruta) => ruta.endsWith('&moneda=USD'))).toBe(true);
    expect(tablaDelHistorico()).toHaveTextContent(/4,50/);
  });

  it('al cambiar de moneda no quedan a la vista las cifras de la anterior mientras carga la nueva', async () => {
    await montar();
    const lento = diferida<unknown>();
    servidor.resumen = () => lento.promesa;

    await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'Moneda' }), { target: { value: 'USD' } }));

    expect(screen.getByRole('status', { name: 'Cargando tus gastos' })).toBeInTheDocument();
    expect(screen.queryByText('$30.000')).not.toBeInTheDocument();
    await act(async () => lento.resolver(resumenDePrueba({ moneda: 'USD' })));
  });

  it('una respuesta tardía de la moneda anterior no pisa la nueva', async () => {
    const tardiaDeClp = diferida<unknown>();
    servidor.resumen = (mes, moneda) => (moneda === 'CLP' ? tardiaDeClp.promesa : resumenSegunDatos(mes, moneda));
    await montar();

    await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'Moneda' }), { target: { value: 'USD' } }));
    await act(async () => tardiaDeClp.resolver(resumenDePrueba({ moneda: 'CLP', gasto_real: '999999.00', total_estimado: '999999.00' })));

    expect(screen.queryByText('$999.999')).not.toBeInTheDocument();
    expect(tablaDelHistorico()).toHaveTextContent(/4,50/);
  });
});

describe('descargar los cobros del informe (S3-CH-25)', () => {
  it('descarga el mes y la moneda que se están viendo, con un nombre que lo dice', async () => {
    await montar('/informes?mes=2026-10');

    await act(async () => fireEvent.click(botonDescargar()));

    expect(exportacionesPedidas()).toEqual(['/suscripciones/exportar-csv/?desde=2026-10-01&hasta=2026-10-31&moneda=CLP']);
    expect(guardarArchivo).toHaveBeenCalledWith('cobros_2026-10-01_2026-10-31_CLP.csv', CSV, 'text/csv;charset=utf-8');
    expect(screen.getByText('Descargamos cobros_2026-10-01_2026-10-31_CLP.csv.')).toBeInTheDocument();
  });

  it('al pasar a otro mes y otra moneda, la descarga es de lo nuevo y el aviso anterior se va', async () => {
    await montar('/informes?mes=2026-10');
    await act(async () => fireEvent.click(botonDescargar()));
    expect(screen.getByText(/Descargamos cobros_2026-10-01_2026-10-31_CLP\.csv/)).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' })));
    await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'Moneda' }), { target: { value: 'USD' } }));
    expect(screen.queryByText(/Descargamos/)).not.toBeInTheDocument();

    await act(async () => fireEvent.click(botonDescargar()));

    expect(exportacionesPedidas().at(-1)).toBe('/suscripciones/exportar-csv/?desde=2026-09-01&hasta=2026-09-30&moneda=USD');
    expect(guardarArchivo).toHaveBeenLastCalledWith('cobros_2026-09-01_2026-09-30_USD.csv', CSV, 'text/csv;charset=utf-8');
  });

  it('si la descarga falla, avisa y el histórico sigue a la vista', async () => {
    servidor.exportacion = () => Promise.reject(new ErrorDeApi('Error interno.', 500));
    await montar();

    await act(async () => fireEvent.click(botonDescargar()));

    expect(screen.getByRole('alert')).toHaveTextContent(MENSAJE_ERROR_DESCARGA);
    expect(guardarArchivo).not.toHaveBeenCalled();
    expect(tablaDelHistorico()).toHaveTextContent('$30.000');
  });
});

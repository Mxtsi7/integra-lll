// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from '../../../../shared/src/api/cliente';
import { guardarTokens } from '../../../../shared/src/auth';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { MENSAJE_ERROR_DESCARGA } from '../../hooks/useDescargaDeCobros';
import { crearTokenDePrueba } from '../../test/tokensDePrueba';
import { guardarArchivo } from '../../utils/descargas';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import { DescargarCobros } from './DescargarCobros';

// Solo se simula la red (pedir) y el guardado del archivo, que toca el navegador.
vi.mock('../../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});
vi.mock('../../utils/descargas', () => ({ guardarArchivo: vi.fn() }));

const TOKEN = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };
const CSV = 'servicio,categoria,monto,moneda,fecha,origen,estado\r\nSpotify,musica,5900.00,CLP,2026-10-05,manual,activo\r\n';

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

type Salida = string | Error | Promise<string>;
function simularRed(salida: Salida = CSV) {
  vi.mocked(pedir).mockImplementation((ruta: string) => {
    if (!ruta.startsWith('/suscripciones/exportar-csv/')) return Promise.resolve(PERSONA_ACTUAL);
    return salida instanceof Error ? Promise.reject(salida) : Promise.resolve(salida);
  });
}
const exportaciones = () =>
  vi.mocked(pedir).mock.calls.map(([ruta]) => String(ruta)).filter((ruta) => ruta.startsWith('/suscripciones/exportar-csv/'));

const montar = async (mes = '2026-10', moneda = 'CLP') => {
  const vista = render(<DescargarCobros mes={mes} moneda={moneda} />, { wrapper: Proveedores });
  await act(async () => {});
  return vista;
};
const boton = () => screen.getByRole('button', { name: /^Descarg/ });
const pulsar = () => act(async () => fireEvent.click(boton()));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset();
  vi.mocked(guardarArchivo).mockReset();
  guardarTokens({ access_token: TOKEN, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('descargar los cobros del mes (S3-CH-25)', () => {
  it('dice qué se va a descargar: los cobros de ese mes y esa moneda, en CSV', async () => {
    simularRed();
    await montar('2026-10', 'USD');

    expect(screen.getByRole('heading', { name: 'Descargar cobros' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Un archivo CSV con todos los cobros de octubre de 2026 en USD, uno por fila. Incluye también los de suscripciones que eliminaste, así que puede sumar más que el gasto real.',
      ),
    ).toBeInTheDocument();
    expect(boton()).toHaveTextContent('Descargar CSV');
    expect(boton()).toBeEnabled();
  });

  it('pide el rango completo del mes y la moneda, y guarda el archivo con su nombre', async () => {
    simularRed();
    await montar('2026-11', 'CLP');

    await pulsar();

    expect(exportaciones()).toEqual(['/suscripciones/exportar-csv/?desde=2026-11-01&hasta=2026-11-30&moneda=CLP']);
    expect(guardarArchivo).toHaveBeenCalledWith('cobros_2026-11-01_2026-11-30_CLP.csv', CSV, 'text/csv;charset=utf-8');
  });

  it('al terminar avisa cuál archivo se descargó, sin interrumpir', async () => {
    simularRed();
    await montar();

    await pulsar();

    const aviso = screen.getByRole('status');
    expect(aviso).toHaveTextContent('Descargamos cobros_2026-10-01_2026-10-31_CLP.csv.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(boton()).toBeEnabled();
  });

  it('mientras descarga lo dice y el botón no se puede volver a pulsar', async () => {
    let responder!: (csv: string) => void;
    simularRed(new Promise<string>((alResponder) => (responder = alResponder)));
    await montar();

    await pulsar();

    expect(boton()).toHaveTextContent('Descargando…');
    expect(boton()).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => responder(CSV));
    expect(boton()).toHaveTextContent('Descargar CSV');
  });

  it('un doble clic seguido pide un solo archivo', async () => {
    let responder!: (csv: string) => void;
    simularRed(new Promise<string>((alResponder) => (responder = alResponder)));
    await montar();

    await act(async () => {
      fireEvent.click(boton());
      fireEvent.click(boton());
    });

    expect(exportaciones()).toHaveLength(1);
    await act(async () => responder(CSV));
  });
});

describe('cuando la descarga falla (S3-CH-25)', () => {
  it('avisa con una alerta, no guarda nada y deja volver a intentar', async () => {
    simularRed(new ErrorDeApi('Error interno.', 500));
    await montar();

    await pulsar();

    expect(screen.getByRole('alert')).toHaveTextContent(MENSAJE_ERROR_DESCARGA);
    expect(guardarArchivo).not.toHaveBeenCalled();
    expect(boton()).toBeEnabled();

    simularRed();
    await pulsar();
    expect(guardarArchivo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sin red dice que no hay conexión', async () => {
    simularRed(new TypeError('Failed to fetch'));
    await montar();

    await pulsar();

    expect(screen.getByRole('alert')).toHaveTextContent(MENSAJE_SIN_RED);
  });
});

describe('el aviso sigue al mes y la moneda (S3-CH-25)', () => {
  it('al pasar a otro mes el aviso del archivo anterior se va, y la descarga siguiente es de ese mes', async () => {
    simularRed();
    const { rerender } = await montar('2026-10', 'CLP');
    await pulsar();
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<DescargarCobros mes="2026-09" moneda="CLP" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await pulsar();
    expect(exportaciones().at(-1)).toBe('/suscripciones/exportar-csv/?desde=2026-09-01&hasta=2026-09-30&moneda=CLP');
  });

  it('al pasar a otra moneda la descarga siguiente es de esa moneda y su archivo lo dice', async () => {
    simularRed();
    const { rerender } = await montar('2026-10', 'CLP');

    rerender(<DescargarCobros mes="2026-10" moneda="USD" />);
    await pulsar();

    expect(exportaciones().at(-1)).toBe('/suscripciones/exportar-csv/?desde=2026-10-01&hasta=2026-10-31&moneda=USD');
    expect(screen.getByRole('status')).toHaveTextContent('cobros_2026-10-01_2026-10-31_USD.csv');
  });
});

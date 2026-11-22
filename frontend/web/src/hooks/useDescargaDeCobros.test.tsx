// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from '../../../shared/src/api/cliente';
import { guardarTokens } from '../../../shared/src/auth';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { guardarArchivo } from '../utils/descargas';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import { MENSAJE_ERROR_DESCARGA, useDescargaDeCobros } from './useDescargaDeCobros';

// Solo se simula la red (pedir) y el guardado del archivo, que toca el navegador.
vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});
vi.mock('../utils/descargas', () => ({ guardarArchivo: vi.fn() }));

const TOKEN_DE_A = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const TOKEN_DE_B = crearTokenDePrueba({ user_id: 8, organizacion_id: 'org-b', sid: 'sesion-b', jti: 'b-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };
const CSV = 'servicio,categoria,monto,moneda,fecha,origen,estado\r\nSpotify,musica,5900.00,CLP,2026-10-05,manual,activo\r\n';

const OCTUBRE = { desde: '2026-10-01', hasta: '2026-10-31', moneda: 'CLP' };
const NOMBRE_DE_OCTUBRE = 'cobros_2026-10-01_2026-10-31_CLP.csv';

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

type Salida = string | Error | Promise<string>;

/** Responde /usuarios/me/ con la persona actual y la exportación con lo que decida el test. */
function simularRed(salida: Salida = CSV) {
  vi.mocked(pedir).mockImplementation((ruta: string) => {
    if (!ruta.startsWith('/suscripciones/exportar-csv/')) return Promise.resolve(PERSONA_ACTUAL);
    if (salida instanceof Error) return Promise.reject(salida);
    return Promise.resolve(salida);
  });
}
const exportaciones = () =>
  vi.mocked(pedir).mock.calls.filter(([ruta]) => String(ruta).startsWith('/suscripciones/exportar-csv/'));

function diferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((alResolver) => {
    resolver = alResolver;
  });
  return { promesa, resolver };
}

interface Props {
  consulta: typeof OCTUBRE;
  nombre: string;
}
const montar = (inicial: Props = { consulta: OCTUBRE, nombre: NOMBRE_DE_OCTUBRE }) =>
  renderHook(({ consulta, nombre }: Props) => useDescargaDeCobros(consulta, nombre), { initialProps: inicial, wrapper: Proveedores });
type Montaje = ReturnType<typeof montar>['result'];

const descargar = (resultado: Montaje) => act(async () => resultado.current.descargar());

const entraOtraSesion = () =>
  act(async () => {
    guardarTokens({ access_token: TOKEN_DE_B, refresh_token: 'refresh-b' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
  });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset();
  vi.mocked(guardarArchivo).mockReset();
  guardarTokens({ access_token: TOKEN_DE_A, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('descargar los cobros en CSV (S3-CH-25)', () => {
  it('empieza sin descarga en curso y sin resultado', () => {
    simularRed();
    const { result } = montar();

    expect(result.current.enCurso).toBe(false);
    expect(result.current.resultado).toBeNull();
  });

  it('pide el rango y la moneda, lee la respuesta como texto y guarda el archivo con el nombre que se dio', async () => {
    simularRed();
    const { result } = montar();

    await descargar(result);

    expect(exportaciones()).toEqual([['/suscripciones/exportar-csv/?desde=2026-10-01&hasta=2026-10-31&moneda=CLP', { respuesta: 'texto' }]]);
    expect(guardarArchivo).toHaveBeenCalledTimes(1);
    expect(guardarArchivo).toHaveBeenCalledWith(NOMBRE_DE_OCTUBRE, CSV, 'text/csv;charset=utf-8');
    expect(result.current.resultado).toEqual({ tipo: 'lista', nombre: NOMBRE_DE_OCTUBRE });
  });

  it('el contenido que se guarda es el que mandó el servidor, sin tocarlo', async () => {
    const delServidor = 'servicio\r\nMúsica ñandú\r\n';
    simularRed(delServidor);
    const { result } = montar();

    await descargar(result);

    expect(vi.mocked(guardarArchivo).mock.calls[0][1]).toBe(delServidor);
  });

  it('mientras llega el archivo figura en curso, y no se guarda ni se avisa nada antes', async () => {
    const respuesta = diferida<string>();
    simularRed(respuesta.promesa);
    const { result } = montar();

    await act(async () => {
      void result.current.descargar();
    });

    expect(result.current.enCurso).toBe(true);
    expect(result.current.resultado).toBeNull();
    expect(guardarArchivo).not.toHaveBeenCalled();

    await act(async () => respuesta.resolver(CSV));
    expect(result.current.enCurso).toBe(false);
    expect(guardarArchivo).toHaveBeenCalledTimes(1);
  });

  it('un segundo clic mientras corre no pide otro archivo', async () => {
    const respuesta = diferida<string>();
    simularRed(respuesta.promesa);
    const { result } = montar();

    await act(async () => {
      void result.current.descargar();
      void result.current.descargar();
    });

    expect(exportaciones()).toHaveLength(1);
    await act(async () => respuesta.resolver(CSV));
  });

  it('al empezar otra descarga el aviso de la anterior se va', async () => {
    simularRed();
    const { result } = montar();
    await descargar(result);
    expect(result.current.resultado).not.toBeNull();

    const segunda = diferida<string>();
    simularRed(segunda.promesa);
    await act(async () => {
      void result.current.descargar();
    });

    expect(result.current.resultado).toBeNull();
    await act(async () => segunda.resolver(CSV));
  });

  it('terminada una descarga se puede pedir otra', async () => {
    simularRed();
    const { result } = montar();

    await descargar(result);
    await descargar(result);

    expect(exportaciones()).toHaveLength(2);
    expect(guardarArchivo).toHaveBeenCalledTimes(2);
  });
});

describe('fallos de la descarga (S3-CH-25)', () => {
  it('un error del servidor deja un mensaje y no guarda ningún archivo', async () => {
    simularRed(new ErrorDeApi('Error interno.', 500));
    const { result } = montar();

    await descargar(result);

    expect(result.current.resultado).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_DESCARGA });
    expect(guardarArchivo).not.toHaveBeenCalled();
    expect(result.current.enCurso).toBe(false);
  });

  it('un 400 no repite el texto técnico del servidor', async () => {
    simularRed(new ErrorDeApi('Debe ser igual o posterior a la fecha desde.', 400, { hasta: ['Debe ser igual o posterior a la fecha desde.'] }));
    const { result } = montar();

    await descargar(result);

    expect(result.current.resultado).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_DESCARGA });
  });

  it('sin red dice que no hay conexión', async () => {
    simularRed(new TypeError('Failed to fetch'));
    const { result } = montar();

    await descargar(result);

    expect(result.current.resultado).toEqual({ tipo: 'error', mensaje: MENSAJE_SIN_RED });
  });

  it('si falla el guardado del archivo en el navegador, también lo dice', async () => {
    simularRed();
    vi.mocked(guardarArchivo).mockImplementation(() => {
      throw new Error('Sin permiso para guardar.');
    });
    const { result } = montar();

    await descargar(result);

    expect(result.current.resultado).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_DESCARGA });
  });

  it('después de un fallo se puede volver a intentar', async () => {
    simularRed(new ErrorDeApi('Error interno.', 500));
    const { result } = montar();
    await descargar(result);

    simularRed();
    await descargar(result);

    expect(result.current.resultado).toEqual({ tipo: 'lista', nombre: NOMBRE_DE_OCTUBRE });
  });
});

describe('el aviso sigue a la selección (S3-CH-25)', () => {
  it('al cambiar de mes el aviso de la descarga anterior desaparece', async () => {
    simularRed();
    const { result, rerender } = montar();
    await descargar(result);
    expect(result.current.resultado).not.toBeNull();

    rerender({ consulta: { desde: '2026-11-01', hasta: '2026-11-30', moneda: 'CLP' }, nombre: 'cobros_2026-11-01_2026-11-30_CLP.csv' });

    expect(result.current.resultado).toBeNull();
  });

  it('al cambiar de moneda el aviso de la descarga anterior desaparece', async () => {
    simularRed();
    const { result, rerender } = montar();
    await descargar(result);

    rerender({ consulta: { ...OCTUBRE, moneda: 'USD' }, nombre: 'cobros_2026-10-01_2026-10-31_USD.csv' });

    expect(result.current.resultado).toBeNull();
  });

  it('con la selección nueva pide el rango y la moneda nuevos', async () => {
    simularRed();
    const { result, rerender } = montar();
    rerender({ consulta: { desde: '2026-11-01', hasta: '2026-11-30', moneda: 'USD' }, nombre: 'cobros_2026-11-01_2026-11-30_USD.csv' });

    await descargar(result);

    expect(exportaciones()).toEqual([['/suscripciones/exportar-csv/?desde=2026-11-01&hasta=2026-11-30&moneda=USD', { respuesta: 'texto' }]]);
    expect(guardarArchivo).toHaveBeenCalledWith('cobros_2026-11-01_2026-11-30_USD.csv', CSV, 'text/csv;charset=utf-8');
  });
});

describe('cambio de sesión con la descarga en vuelo (regla de sesión de Integra III)', () => {
  it('el archivo de A que llega con B ya dentro no se entrega ni se avisa', async () => {
    const respuestaDeA = diferida<string>();
    simularRed(respuestaDeA.promesa);
    const { result } = montar();
    await act(async () => {
      void result.current.descargar();
    });
    await waitFor(() => expect(exportaciones()).toHaveLength(1));

    await entraOtraSesion();
    await act(async () => respuestaDeA.resolver(CSV));

    expect(guardarArchivo).not.toHaveBeenCalled();
    expect(result.current.resultado).toBeNull();
    expect(result.current.enCurso).toBe(false);
  });

  it('con la sesión ya cambiada no se pide nada', async () => {
    simularRed();
    const { result } = montar();
    await entraOtraSesion();

    await descargar(result);

    expect(exportaciones()).toHaveLength(0);
    expect(result.current.enCurso).toBe(false);
  });

  it('si la página se cierra mientras se descarga, no se guarda el archivo', async () => {
    const respuesta = diferida<string>();
    simularRed(respuesta.promesa);
    const { result, unmount } = montar();
    await act(async () => {
      void result.current.descargar();
    });

    unmount();
    await act(async () => respuesta.resolver(CSV));

    expect(guardarArchivo).not.toHaveBeenCalled();
  });
});

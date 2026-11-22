// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenDelMes } from '@ojoalgasto/shared';
import { ErrorDeApi, pedir } from '../../../shared/src/api/cliente';
import { guardarTokens } from '../../../shared/src/auth';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { resumenDePrueba } from '../test/informesDePrueba';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import { MENSAJE_ERROR_INFORME, useInformeMensual, type CargaInforme } from './useInformeMensual';

// Solo se simula la red (pedir). El hook, el cliente de shared y el AuthProvider son los reales.
vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});

const TOKEN_DE_A = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const TOKEN_DE_B = crearTokenDePrueba({ user_id: 8, organizacion_id: 'org-b', sid: 'sesion-b', jti: 'b-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

type Respuesta = Partial<ResumenDelMes> | Error | Promise<ResumenDelMes>;

/** Responde /usuarios/me/ con la persona actual y cada resumen según el mes y la moneda que se pidieron. */
function simularRed(respuesta: (mes: string, moneda: string) => Respuesta = () => ({})) {
  vi.mocked(pedir).mockImplementation((ruta: string) => {
    const coincidencia = /^\/suscripciones\/resumen\/\?mes=(\d{4}-\d{2})&moneda=([A-Za-z]+)$/.exec(ruta);
    if (coincidencia === null) return Promise.resolve(PERSONA_ACTUAL);
    const [, mes, moneda] = coincidencia;
    const salida = respuesta(mes, moneda);
    if (salida instanceof Error) return Promise.reject(salida);
    if (salida instanceof Promise) return salida;
    return Promise.resolve(resumenDePrueba({ periodo: mes, moneda, ...salida }));
  });
}
const resumenesPedidos = () =>
  vi.mocked(pedir).mock.calls.map(([ruta]) => String(ruta)).filter((ruta) => ruta.startsWith('/suscripciones/resumen/'));

function diferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((alResolver) => {
    resolver = alResolver;
  });
  return { promesa, resolver };
}

interface Props {
  mes: string;
  moneda: string;
}
const montar = (inicial: Props = { mes: '2026-10', moneda: 'CLP' }) =>
  renderHook(({ mes, moneda }: Props) => useInformeMensual(mes, moneda), { initialProps: inicial, wrapper: Proveedores });

const entraOtraSesion = () =>
  act(async () => {
    guardarTokens({ access_token: TOKEN_DE_B, refresh_token: 'refresh-b' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
  });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset();
  guardarTokens({ access_token: TOKEN_DE_A, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('el informe de un mes y los anteriores (S3-CH-25)', () => {
  it('pide el mes elegido y los cinco anteriores, con la moneda, y entrega un resumen por mes, el elegido al final', async () => {
    simularRed();
    const { result } = montar();

    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(resumenesPedidos()).toEqual([
      '/suscripciones/resumen/?mes=2026-05&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-06&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-07&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-08&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-09&moneda=CLP',
      '/suscripciones/resumen/?mes=2026-10&moneda=CLP',
    ]);
    const carga = result.current.carga;
    expect(carga.tipo === 'listo' && carga.meses.map((mes) => mes.periodo)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('mientras llegan las respuestas está cargando', () => {
    simularRed(() => new Promise<ResumenDelMes>(() => {}));
    const { result } = montar();

    expect(result.current.carga).toEqual({ tipo: 'cargando' });
  });

  it('cada resumen es de la moneda pedida: los montos de otra moneda no se mezclan', async () => {
    simularRed((mes, moneda) => ({ gasto_real: moneda === 'USD' ? '4.50' : '5900.00' }));
    const { result } = montar({ mes: '2026-10', moneda: 'USD' });

    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    const carga = result.current.carga;
    expect(carga.tipo === 'listo' && carga.meses.every((mes) => mes.moneda === 'USD' && mes.gasto_real === '4.50')).toBe(true);
  });
});

describe('cambiar de mes o de moneda (S3-CH-25)', () => {
  it('al cambiar de mes pide lo nuevo y mientras tanto no deja a la vista el mes anterior', async () => {
    simularRed();
    const { result, rerender } = montar({ mes: '2026-10', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    simularRed(() => new Promise<ResumenDelMes>(() => {}));
    rerender({ mes: '2026-11', moneda: 'CLP' });

    expect(result.current.carga).toEqual({ tipo: 'cargando' });
  });

  it('en ningún dibujo se ve lo del mes anterior con el mes nuevo, ni por un instante', async () => {
    simularRed();
    const dibujos: CargaInforme[] = [];
    const { result, rerender } = renderHook(
      ({ mes, moneda }: Props) => {
        const salida = useInformeMensual(mes, moneda);
        dibujos.push(salida.carga);
        return salida;
      },
      { initialProps: { mes: '2026-10', moneda: 'CLP' }, wrapper: Proveedores },
    );
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    const dibujosAntes = dibujos.length;

    rerender({ mes: '2026-11', moneda: 'CLP' });

    // El primer dibujo con el mes nuevo ya es «cargando»: no pasa por el informe del mes anterior.
    expect(dibujos[dibujosAntes]).toEqual({ tipo: 'cargando' });
  });

  it('al cambiar de mes entrega los meses nuevos, con el elegido al final', async () => {
    simularRed();
    const { result, rerender } = montar({ mes: '2026-10', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    rerender({ mes: '2026-11', moneda: 'CLP' });

    await waitFor(() => {
      const carga = result.current.carga;
      expect(carga.tipo === 'listo' && carga.meses[carga.meses.length - 1].periodo).toBe('2026-11');
    });
  });

  it('al cambiar de moneda vuelve a pedir los seis meses con la moneda nueva', async () => {
    simularRed();
    const { result, rerender } = montar({ mes: '2026-10', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    rerender({ mes: '2026-10', moneda: 'USD' });

    await waitFor(() => {
      const carga = result.current.carga;
      expect(carga.tipo === 'listo' && carga.meses.every((mes) => mes.moneda === 'USD')).toBe(true);
    });
    expect(resumenesPedidos().slice(-6).every((ruta) => ruta.endsWith('&moneda=USD'))).toBe(true);
  });

  it('una respuesta tardía de lo que ya se dejó no pisa lo nuevo', async () => {
    const tardia = diferida<ResumenDelMes>();
    simularRed((mes, moneda) => (moneda === 'CLP' ? tardia.promesa : {}));
    const { result, rerender } = montar({ mes: '2026-10', moneda: 'CLP' });

    rerender({ mes: '2026-10', moneda: 'USD' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    await act(async () => tardia.resolver(resumenDePrueba({ moneda: 'CLP', gasto_real: '999999.00' })));

    const carga = result.current.carga;
    expect(carga.tipo === 'listo' && carga.meses.every((mes) => mes.moneda === 'USD')).toBe(true);
  });
});

describe('errores y reintento (S3-CH-25)', () => {
  it('si falla un solo mes no hay un informe a medias: hay un error', async () => {
    simularRed((mes) => (mes === '2026-07' ? new ErrorDeApi('Error interno.', 500) : {}));
    const { result } = montar();

    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    expect(result.current.carga).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_INFORME });
  });

  it('sin red dice que no hay conexión', async () => {
    simularRed(() => new TypeError('Failed to fetch'));
    const { result } = montar();

    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    expect(result.current.carga).toEqual({ tipo: 'error', mensaje: MENSAJE_SIN_RED });
  });

  it('Reintentar vuelve a pedir los seis meses y muestra lo que llegue', async () => {
    simularRed(() => new ErrorDeApi('Error interno.', 500));
    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    simularRed();
    act(() => result.current.reintentar());

    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    expect(resumenesPedidos()).toHaveLength(12);
  });
});

describe('cambio de sesión con el informe en vuelo (regla de sesión de Integra III)', () => {
  it('la respuesta de A que llega con B ya dentro no se muestra', async () => {
    const respuestaDeA = diferida<ResumenDelMes>();
    simularRed(() => respuestaDeA.promesa);
    const { result } = montar();
    await waitFor(() => expect(resumenesPedidos()).toHaveLength(6));

    await entraOtraSesion();
    await act(async () => respuestaDeA.resolver(resumenDePrueba({ gasto_real: '123456.00' })));

    expect(result.current.carga).toEqual({ tipo: 'cargando' });
  });

  it('un fallo de A que llega con B ya dentro tampoco aparece', async () => {
    const falloDeA = diferida<ResumenDelMes>();
    simularRed(() => falloDeA.promesa.then(() => Promise.reject(new TypeError('Failed to fetch'))));
    const { result } = montar();
    await waitFor(() => expect(resumenesPedidos()).toHaveLength(6));

    await entraOtraSesion();
    await act(async () => falloDeA.resolver(resumenDePrueba()));

    expect(result.current.carga).toEqual({ tipo: 'cargando' });
  });
});

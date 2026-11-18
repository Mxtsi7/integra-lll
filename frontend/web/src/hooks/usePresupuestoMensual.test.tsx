// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from '../../../shared/src/api/cliente';
import { guardarTokens } from '../../../shared/src/auth';
import type { ComparacionDePresupuesto } from '../../../shared/src/api/presupuesto';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import {
  MENSAJE_ERROR_AL_CARGAR_PRESUPUESTO,
  MENSAJE_ERROR_AL_GUARDAR_PRESUPUESTO,
  MENSAJE_SIN_PERMISO_PARA_GUARDAR,
  usePresupuestoMensual,
  type CargaDePresupuesto,
  type EdicionDePresupuesto,
} from './usePresupuestoMensual';

// Solo se simula la red (pedir). El hook, el cliente de presupuesto y el AuthProvider son los reales.
vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});

const TOKEN_DE_A = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const TOKEN_DE_B = crearTokenDePrueba({ user_id: 8, organizacion_id: 'org-b', sid: 'sesion-b', jti: 'b-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };

const comparacionDe = (parcial: Partial<ComparacionDePresupuesto> = {}): ComparacionDePresupuesto => ({
  mes: '2026-11',
  moneda: 'CLP',
  presupuesto: '200000.00',
  gasto_real: '120000.00',
  gasto_proyectado: '45000.00',
  total_esperado: '165000.00',
  diferencia: '35000.00',
  porcentaje_consumido: 82.5,
  alerta_superado: false,
  ...parcial,
});

const guardadoDe = (monto: string) => ({
  id: 'p-1',
  mes: '2026-11',
  moneda: 'CLP',
  monto,
  creado_en: '2026-11-18T12:00:00-03:00',
  actualizado_en: '2026-11-18T12:00:00-03:00',
});

interface Cuerpo {
  mes: string;
  moneda: string;
  monto: string;
}
interface Opciones {
  method?: string;
  body?: Cuerpo;
}

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

/** Responde /usuarios/me/ con la persona actual y deja que el test decida qué responde la comparación y el guardado. */
function simularRed(respuestas: {
  comparar: (mes: string, moneda: string) => Promise<unknown>;
  guardar?: (cuerpo: Cuerpo) => Promise<unknown>;
}) {
  vi.mocked(pedir).mockImplementation(((ruta: string, opciones?: Opciones) => {
    if (!ruta.startsWith('/suscripciones/presupuesto/')) return Promise.resolve(PERSONA_ACTUAL);
    if (opciones?.method === 'POST') return respuestas.guardar!(opciones.body!);
    const consulta = new URLSearchParams(ruta.split('?')[1]);
    return respuestas.comparar(consulta.get('mes')!, consulta.get('moneda')!);
  }) as typeof pedir);
}
const llamadasAlServidor = () =>
  vi.mocked(pedir).mock.calls.filter(([ruta]) => String(ruta).startsWith('/suscripciones/presupuesto/')) as unknown as [string, Opciones | undefined][];
const consultas = () => llamadasAlServidor().filter(([, opciones]) => opciones?.method !== 'POST');
const guardados = () => llamadasAlServidor().filter(([, opciones]) => opciones?.method === 'POST');

/** Otra pestaña guarda los tokens de B: a esta solo le llega el evento `storage`. */
const entraOtraSesion = () =>
  act(async () => {
    guardarTokens({ access_token: TOKEN_DE_B, refresh_token: 'refresh-b' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
  });

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((alResolver, alRechazar) => {
    resolver = alResolver;
    rechazar = alRechazar;
  });
  return { promesa, resolver, rechazar };
}

/** Lo que el hook entregó en un render, junto al mes y la moneda con que se pidió. */
interface Registro {
  mes: string;
  moneda: string;
  carga: CargaDePresupuesto;
  edicion: EdicionDePresupuesto;
  montoGuardado: string | null;
}

/** Con `renders` se anota CADA render, no solo el último: uno intermedio con datos viejos se vería como un parpadeo. */
const montar = (mes = '2026-11', moneda = 'CLP', renders?: Registro[]) =>
  renderHook(
    ({ mes: unMes, moneda: unaMoneda }) => {
      const estado = usePresupuestoMensual(unMes, unaMoneda);
      renders?.push({ mes: unMes, moneda: unaMoneda, carga: estado.carga, edicion: estado.edicion, montoGuardado: estado.montoGuardado });
      return estado;
    },
    { wrapper: Proveedores, initialProps: { mes, moneda } },
  );

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset();
  guardarTokens({ access_token: TOKEN_DE_A, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('la comparación del presupuesto (S3-CH-27)', () => {
  it('empieza cargando y entrega lo que calculó el servidor para ese mes y esa moneda, sin tocarlo', async () => {
    const delServidor = comparacionDe({ alerta_superado: true, diferencia: '-10000.00', porcentaje_consumido: 105, total_esperado: '210000.00' });
    simularRed({ comparar: async () => delServidor });

    const { result } = montar('2026-11', 'CLP');
    expect(result.current.carga).toEqual({ tipo: 'cargando' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(result.current.carga).toEqual({ tipo: 'listo', comparacion: delServidor });
    expect(consultas()).toHaveLength(1);
    expect(consultas()[0][0]).toBe('/suscripciones/presupuesto/?mes=2026-11&moneda=CLP');
  });

  it('un mes sin presupuesto llega como lo manda el servidor: presupuesto null, no un 0', async () => {
    const sinPresupuesto = comparacionDe({ presupuesto: null, diferencia: null, porcentaje_consumido: 0 });
    simularRed({ comparar: async () => sinPresupuesto });

    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(result.current.carga).toEqual({ tipo: 'listo', comparacion: sinPresupuesto });
  });

  it('un gasto de cero llega como cero y no se confunde con un error', async () => {
    const sinGasto = comparacionDe({ gasto_real: '0.00', gasto_proyectado: '0.00', total_esperado: '0.00', diferencia: '200000.00', porcentaje_consumido: 0 });
    simularRed({ comparar: async () => sinGasto });

    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(result.current.carga).toEqual({ tipo: 'listo', comparacion: sinGasto });
  });

  it('al cambiar de mes ningún render muestra la comparación del mes anterior, ni por un instante', async () => {
    simularRed({ comparar: async (mes) => comparacionDe({ mes, presupuesto: mes === '2026-11' ? '200000.00' : '300000.00' }) });
    const renders: Registro[] = [];
    const { result, rerender } = montar('2026-11', 'CLP', renders);
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    renders.length = 0;
    rerender({ mes: '2026-12', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    const conDatosViejos = renders.filter(({ mes, carga }) => mes === '2026-12' && carga.tipo === 'listo' && carga.comparacion.mes === '2026-11');
    expect(conDatosViejos).toEqual([]);
    expect(renders[0]).toMatchObject({ mes: '2026-12', carga: { tipo: 'cargando' } });
    expect(result.current.carga).toEqual({ tipo: 'listo', comparacion: comparacionDe({ mes: '2026-12', presupuesto: '300000.00' }) });
  });

  it('al cambiar de moneda ningún render muestra montos de la moneda anterior: las monedas no se mezclan', async () => {
    simularRed({ comparar: async (_mes, moneda) => comparacionDe({ moneda, presupuesto: moneda === 'CLP' ? '200000.00' : '150.00' }) });
    const renders: Registro[] = [];
    const { result, rerender } = montar('2026-11', 'CLP', renders);
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    renders.length = 0;
    rerender({ mes: '2026-11', moneda: 'USD' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    const conMontosDePesos = renders.filter(({ moneda, carga }) => moneda === 'USD' && carga.tipo === 'listo' && carga.comparacion.moneda === 'CLP');
    expect(conMontosDePesos).toEqual([]);
    expect(renders[0]).toMatchObject({ moneda: 'USD', carga: { tipo: 'cargando' } });
    expect(result.current.carga).toEqual({ tipo: 'listo', comparacion: comparacionDe({ moneda: 'USD', presupuesto: '150.00' }) });
    expect(consultas().map(([ruta]) => ruta)).toEqual([
      '/suscripciones/presupuesto/?mes=2026-11&moneda=CLP',
      '/suscripciones/presupuesto/?mes=2026-11&moneda=USD',
    ]);
  });

  it('una respuesta tardía de un mes que ya se dejó no pisa la del mes actual', async () => {
    const delMesViejo = diferida<unknown>();
    simularRed({ comparar: (mes) => (mes === '2026-11' ? delMesViejo.promesa : Promise.resolve(comparacionDe({ mes, presupuesto: '300000.00' }))) });
    const { result, rerender } = montar('2026-11');
    await waitFor(() => expect(consultas()).toHaveLength(1));

    rerender({ mes: '2026-12', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    await act(async () => delMesViejo.resolver(comparacionDe({ mes: '2026-11', presupuesto: '200000.00' })));

    expect(result.current.carga).toEqual({ tipo: 'listo', comparacion: comparacionDe({ mes: '2026-12', presupuesto: '300000.00' }) });
  });
});

describe('un error de consulta (S3-CH-27)', () => {
  it('es un error: no se convierte en un gasto de cero ni en un mes sin presupuesto', async () => {
    simularRed({ comparar: () => Promise.reject(new ErrorDeApi('Error interno', 500)) });

    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    expect(result.current.carga).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_AL_CARGAR_PRESUPUESTO });
  });

  it('sin red lo dice', async () => {
    simularRed({ comparar: () => Promise.reject(new TypeError('Failed to fetch')) });

    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    expect(result.current.carga).toEqual({ tipo: 'error', mensaje: MENSAJE_SIN_RED });
  });

  it('reintentar vuelve a pedirlo y se recupera', async () => {
    let intentos = 0;
    simularRed({ comparar: async () => (++intentos === 1 ? Promise.reject(new ErrorDeApi('Error interno', 500)) : comparacionDe()) });
    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    act(() => result.current.reintentar());
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(consultas()).toHaveLength(2);
  });

  it('con un error de consulta no se puede editar: guardar a ciegas pisaría un presupuesto que no se alcanzó a leer', async () => {
    simularRed({ comparar: () => Promise.reject(new ErrorDeApi('Error interno', 500)), guardar: async () => guardadoDe('1000') });
    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    act(() => result.current.abrirEdicion());

    expect(result.current.edicion).toEqual({ tipo: 'cerrada' });
  });

  it('mientras carga tampoco se puede editar', async () => {
    simularRed({ comparar: () => new Promise(() => {}) });
    const { result } = montar();

    act(() => result.current.abrirEdicion());

    expect(result.current.edicion).toEqual({ tipo: 'cerrada' });
  });
});

describe('guardar el presupuesto (S3-CH-27)', () => {
  async function conComparacionLista(comparar: () => Promise<unknown>, guardar: (cuerpo: Cuerpo) => Promise<unknown>) {
    simularRed({ comparar, guardar });
    const montado = montar();
    await waitFor(() => expect(montado.result.current.carga.tipo).toBe('listo'));
    act(() => montado.result.current.abrirEdicion());
    return montado;
  }

  it('abrir y cancelar el formulario no toca el servidor', async () => {
    const { result } = await conComparacionLista(async () => comparacionDe(), async () => guardadoDe('1000'));
    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: null });

    act(() => result.current.cancelarEdicion());

    expect(result.current.edicion).toEqual({ tipo: 'cerrada' });
    expect(guardados()).toHaveLength(0);
  });

  it('guarda el monto del mes y la moneda que se miran, y vuelve a pedir la comparación al servidor', async () => {
    let presupuesto = '200000.00';
    const { result } = await conComparacionLista(
      async () => comparacionDe({ presupuesto }),
      async (cuerpo) => {
        presupuesto = `${cuerpo.monto}.00`;
        return guardadoDe(presupuesto);
      },
    );

    await act(async () => result.current.guardar('250000'));
    await waitFor(() => expect(consultas()).toHaveLength(2));
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(guardados()).toHaveLength(1);
    expect(guardados()[0][1]?.body).toEqual({ mes: '2026-11', moneda: 'CLP', monto: '250000' });
    expect(result.current.edicion).toEqual({ tipo: 'cerrada' });
    expect(result.current.montoGuardado).toBe('250000.00');
    // Lo que se ve después de guardar es lo que el servidor devuelve ahora, no lo que se escribió.
    expect(result.current.carga).toEqual({ tipo: 'listo', comparacion: comparacionDe({ presupuesto: '250000.00' }) });
  });

  it('guarda en la moneda que se mira, no en pesos', async () => {
    simularRed({ comparar: async (mes, moneda) => comparacionDe({ mes, moneda }), guardar: async () => guardadoDe('10.00') });
    const { result } = montar('2026-11', 'USD');
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());

    await act(async () => result.current.guardar('10'));

    expect(guardados()[0][1]?.body).toEqual({ mes: '2026-11', moneda: 'USD', monto: '10' });
  });

  it('cancelar mientras guarda no cierra el formulario: la respuesta todavía puede traer un error', async () => {
    const respuesta = diferida<unknown>();
    const { result } = await conComparacionLista(async () => comparacionDe(), () => respuesta.promesa);
    act(() => void result.current.guardar('250000'));

    act(() => result.current.cancelarEdicion());

    expect(result.current.edicion).toEqual({ tipo: 'guardando' });
    await act(async () => respuesta.resolver(guardadoDe('250000.00')));
  });

  it('mientras guarda, el formulario está guardando; un segundo guardado no sale', async () => {
    const respuesta = diferida<unknown>();
    const { result } = await conComparacionLista(async () => comparacionDe(), () => respuesta.promesa);

    act(() => void result.current.guardar('250000'));
    expect(result.current.edicion).toEqual({ tipo: 'guardando' });
    await act(async () => result.current.guardar('250000'));
    expect(guardados()).toHaveLength(1);

    await act(async () => respuesta.resolver(guardadoDe('250000.00')));
  });

  it('el monto que el servidor rechaza (400) deja el formulario abierto con su mensaje, y no recarga', async () => {
    const { result } = await conComparacionLista(
      async () => comparacionDe(),
      () => Promise.reject(new ErrorDeApi('x', 400, { monto: ['Asegúrese de que no haya más de 10 dígitos en total.'] })),
    );

    await act(async () => result.current.guardar('99999999'));

    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: 'Asegúrese de que no haya más de 10 dígitos en total.' });
    expect(result.current.montoGuardado).toBeNull();
    expect(consultas()).toHaveLength(1);
  });

  it('una moneda que el servidor rechaza (400 en el campo moneda) dice lo que dijo el servidor', async () => {
    const { result } = await conComparacionLista(
      async () => comparacionDe(),
      () => Promise.reject(new ErrorDeApi('x', 400, { moneda: ['Selecciona una moneda del catálogo.'] })),
    );

    await act(async () => result.current.guardar('1000'));

    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: 'Selecciona una moneda del catálogo.' });
  });

  it('sin permiso (403) lo dice con palabras claras y no con el texto técnico del servidor', async () => {
    const { result } = await conComparacionLista(
      async () => comparacionDe(),
      () => Promise.reject(new ErrorDeApi('La cabecera X-Organizacion-Id es obligatoria.', 403)),
    );

    await act(async () => result.current.guardar('1000'));

    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: MENSAJE_SIN_PERMISO_PARA_GUARDAR });
  });

  it('un fallo del servidor (500) o sin red deja el formulario abierto con un mensaje claro; y se puede volver a intentar', async () => {
    let intentos = 0;
    const { result } = await conComparacionLista(
      async () => comparacionDe(),
      async () => {
        intentos += 1;
        if (intentos === 1) throw new ErrorDeApi('Error interno', 500);
        if (intentos === 2) throw new TypeError('Failed to fetch');
        return guardadoDe('1000.00');
      },
    );

    await act(async () => result.current.guardar('1000'));
    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: MENSAJE_ERROR_AL_GUARDAR_PRESUPUESTO });

    await act(async () => result.current.guardar('1000'));
    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: MENSAJE_SIN_RED });

    await act(async () => result.current.guardar('1000'));
    await waitFor(() => expect(result.current.edicion).toEqual({ tipo: 'cerrada' }));
    expect(result.current.montoGuardado).toBe('1000.00');
  });

  it('si la comparación falla después de guardar, lo guardado se sabe igual y la consulta se puede reintentar', async () => {
    let consultasHechas = 0;
    const { result } = await conComparacionLista(
      async () => (++consultasHechas === 1 ? comparacionDe() : Promise.reject(new ErrorDeApi('Error interno', 500))),
      async () => guardadoDe('250000.00'),
    );

    await act(async () => result.current.guardar('250000'));
    await waitFor(() => expect(result.current.carga.tipo).toBe('error'));

    expect(result.current.montoGuardado).toBe('250000.00');
  });

  it('cambiar de mes o de moneda cierra el formulario y borra el aviso de guardado: empieza de cero', async () => {
    const { result, rerender } = await conComparacionLista(async () => comparacionDe(), async () => guardadoDe('1000.00'));
    await act(async () => result.current.guardar('1000'));
    await waitFor(() => expect(result.current.montoGuardado).toBe('1000.00'));
    act(() => result.current.abrirEdicion());
    await waitFor(() => expect(result.current.edicion.tipo).toBe('abierta'));

    rerender({ mes: '2026-12', moneda: 'CLP' });

    expect(result.current.edicion).toEqual({ tipo: 'cerrada' });
    expect(result.current.montoGuardado).toBeNull();
    rerender({ mes: '2026-11', moneda: 'CLP' });
    expect(result.current.edicion).toEqual({ tipo: 'cerrada' });
    expect(result.current.montoGuardado).toBeNull();
  });
});

describe('el formulario y el aviso de guardado son de un mes y una moneda (S3-CH-27)', () => {
  it('al cambiar de mes ningún render muestra el aviso de guardado del mes anterior', async () => {
    simularRed({ comparar: async (mes) => comparacionDe({ mes }), guardar: async () => guardadoDe('1000.00') });
    const renders: Registro[] = [];
    const { result, rerender } = montar('2026-11', 'CLP', renders);
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    await act(async () => result.current.guardar('1000'));
    await waitFor(() => expect(result.current.montoGuardado).toBe('1000.00'));
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    renders.length = 0;
    rerender({ mes: '2026-12', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(renders.filter(({ mes, montoGuardado }) => mes === '2026-12' && montoGuardado !== null)).toEqual([]);
  });

  it('al cambiar de mes ningún render muestra el formulario abierto del mes anterior', async () => {
    simularRed({ comparar: async (mes) => comparacionDe({ mes }) });
    const renders: Registro[] = [];
    const { result, rerender } = montar('2026-11', 'CLP', renders);
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());
    expect(result.current.edicion.tipo).toBe('abierta');

    renders.length = 0;
    rerender({ mes: '2026-12', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));

    expect(renders.filter(({ mes, edicion }) => mes === '2026-12' && edicion.tipo !== 'cerrada')).toEqual([]);
  });
});

describe('cambio de mes o de sesión con un guardado pendiente (regla de sesión de Integra III)', () => {
  it('la respuesta de un guardado de noviembre que llega estando en diciembre no cierra ni toca el formulario de diciembre', async () => {
    const respuestaDeNoviembre = diferida<unknown>();
    simularRed({
      comparar: async (mes) => comparacionDe({ mes }),
      guardar: (cuerpo) => (cuerpo.mes === '2026-11' ? respuestaDeNoviembre.promesa : Promise.resolve(guardadoDe('1.00'))),
    });
    const { result, rerender } = montar('2026-11');
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());
    act(() => void result.current.guardar('250000'));

    rerender({ mes: '2026-12', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());
    const consultasAntes = consultas().length;
    await act(async () => respuestaDeNoviembre.resolver(guardadoDe('250000.00')));

    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: null });
    expect(result.current.montoGuardado).toBeNull();
    expect(consultas()).toHaveLength(consultasAntes);
  });

  it('un error de guardado de noviembre que llega estando en diciembre no aparece en diciembre', async () => {
    const falloDeNoviembre = diferida<unknown>();
    simularRed({
      comparar: async (mes) => comparacionDe({ mes }),
      guardar: () => falloDeNoviembre.promesa,
    });
    const { result, rerender } = montar('2026-11');
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());
    act(() => void result.current.guardar('250000'));

    rerender({ mes: '2026-12', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());
    await act(async () => falloDeNoviembre.rechazar(new ErrorDeApi('x', 400, { monto: ['Monto de noviembre inválido.'] })));

    expect(result.current.edicion).toEqual({ tipo: 'abierta', error: null });
  });

  it('en diciembre se puede guardar aunque el guardado de noviembre siga pendiente', async () => {
    simularRed({
      comparar: async (mes) => comparacionDe({ mes }),
      guardar: (cuerpo) => (cuerpo.mes === '2026-11' ? new Promise(() => {}) : Promise.resolve(guardadoDe('1000.00'))),
    });
    const { result, rerender } = montar('2026-11');
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());
    act(() => void result.current.guardar('250000'));
    rerender({ mes: '2026-12', moneda: 'CLP' });
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());

    await act(async () => result.current.guardar('1000'));

    expect(guardados().map(([, opciones]) => opciones?.body)).toEqual([
      { mes: '2026-11', moneda: 'CLP', monto: '250000' },
      { mes: '2026-12', moneda: 'CLP', monto: '1000' },
    ]);
  });

  it('la respuesta de A que llega después de entrar B no se muestra', async () => {
    const respuestaDeA = diferida<unknown>();
    simularRed({ comparar: () => respuestaDeA.promesa });
    const { result } = montar();
    await waitFor(() => expect(consultas()).toHaveLength(1));

    await entraOtraSesion();
    await act(async () => respuestaDeA.resolver(comparacionDe()));

    expect(result.current.carga).toEqual({ tipo: 'cargando' });
  });

  it('un error de A que llega tarde no aparece en la vista de B', async () => {
    const falloDeA = diferida<unknown>();
    simularRed({ comparar: () => falloDeA.promesa });
    const { result } = montar();
    await waitFor(() => expect(consultas()).toHaveLength(1));

    await entraOtraSesion();
    await act(async () => falloDeA.rechazar(new TypeError('Failed to fetch')));

    expect(result.current.carga).toEqual({ tipo: 'cargando' });
  });

  it('el guardado de A que termina después de entrar B no deja aviso ni vuelve a pedir la comparación', async () => {
    const respuestaDeA = diferida<unknown>();
    simularRed({ comparar: async () => comparacionDe(), guardar: () => respuestaDeA.promesa });
    const { result } = montar();
    await waitFor(() => expect(result.current.carga.tipo).toBe('listo'));
    act(() => result.current.abrirEdicion());
    act(() => void result.current.guardar('250000'));

    await entraOtraSesion();
    const consultasAntes = consultas().length;
    await act(async () => respuestaDeA.resolver(guardadoDe('250000.00')));

    expect(result.current.montoGuardado).toBeNull();
    expect(consultas()).toHaveLength(consultasAntes);
  });
});

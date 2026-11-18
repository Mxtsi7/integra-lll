// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidatoDetectado } from '@ojoalgasto/shared';
import { ErrorDeApi, pedir } from '../../../shared/src/api/cliente';
import { guardarTokens } from '../../../shared/src/auth';
import {
  MENSAJE_COBRO_NO_ENCONTRADO,
  MENSAJE_ERROR_AL_CONFIRMAR,
} from '../components/candidatos/confirmacionCandidatos';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { candidatoDePrueba } from '../test/candidatosDePrueba';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import { useConfirmacionCandidatos } from './useConfirmacionCandidatos';

// Solo se simula la red (pedir). El hook, el cliente de shared y el AuthProvider son los reales.
vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});

const TOKEN_DE_A = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const TOKEN_DE_B = crearTokenDePrueba({ user_id: 8, organizacion_id: 'org-b', sid: 'sesion-b', jti: 'b-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };

const SPOTIFY = candidatoDePrueba({ id: 'c-1', servicio: 'Spotify' });
const NETFLIX = candidatoDePrueba({ id: 'c-2', servicio: 'Netflix' });
const SIN_NOMBRE = candidatoDePrueba({ id: 'c-3', servicio: null, servicio_texto: 'PAGO 4471' });

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

type Salida = 'ok' | Error | Promise<unknown>;

/** Responde /usuarios/me/ con la persona actual y deja que el test decida qué pasa con cada confirmación (por id). */
function simularRed(salidaPorId: Record<string, Salida>) {
  vi.mocked(pedir).mockImplementation((ruta: string) => {
    const id = /^\/candidatos\/([^/]+)\/confirmar\/$/.exec(ruta)?.[1];
    if (id === undefined) return Promise.resolve(PERSONA_ACTUAL);
    const salida = salidaPorId[id] ?? 'ok';
    if (salida === 'ok') return Promise.resolve({ id, estado: 'confirmado', aplicacion: 'pendiente' });
    return salida instanceof Error ? Promise.reject(salida) : (salida as Promise<unknown>);
  });
}
const confirmaciones = () => vi.mocked(pedir).mock.calls.filter(([ruta]) => /\/confirmar\/$/.test(String(ruta)));

function diferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((alResolver) => {
    resolver = alResolver;
  });
  return { promesa, resolver };
}

const montar = (alTerminar = vi.fn()) => ({
  alTerminar,
  ...renderHook(() => useConfirmacionCandidatos({ alTerminar }), { wrapper: Proveedores }),
});
const confirmar = (resultado: ReturnType<typeof montar>['result'], candidatos: CandidatoDetectado[]) =>
  act(async () => resultado.current.confirmar(candidatos));

/** Empieza una tanda y no espera a que termine: para las pruebas cuya respuesta sigue pendiente. */
const iniciarConfirmacion = (resultado: ReturnType<typeof montar>['result'], candidatos: CandidatoDetectado[]) =>
  act(async () => {
    void resultado.current.confirmar(candidatos);
  });

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

describe('confirmar cobros (S3-CH-08)', () => {
  it('empieza sin tanda en curso y sin resultado', () => {
    simularRed({});
    const { result } = montar();

    expect(result.current.enCurso).toBe(false);
    expect(result.current.resultado).toBeNull();
  });

  it('manda un POST por cada cobro y deja el resultado de cada uno, en el orden en que se pidieron', async () => {
    simularRed({});
    const { result, alTerminar } = montar();

    await confirmar(result, [SPOTIFY, NETFLIX]);

    expect(confirmaciones().map(([ruta]) => ruta)).toEqual(['/candidatos/c-1/confirmar/', '/candidatos/c-2/confirmar/']);
    expect(confirmaciones().every(([, opciones]) => (opciones as { method: string }).method === 'POST')).toBe(true);
    expect(result.current.resultado).toEqual({
      resultados: [
        { id: 'c-1', nombre: 'Spotify', tipo: 'confirmado' },
        { id: 'c-2', nombre: 'Netflix', tipo: 'confirmado' },
      ],
    });
    expect(alTerminar).toHaveBeenCalledTimes(1);
  });

  it('mientras llegan las respuestas figura en curso, y nada se da por confirmado antes de que el servidor responda', async () => {
    const respuesta = diferida<unknown>();
    simularRed({ 'c-1': respuesta.promesa });
    const { result, alTerminar } = montar();

    await iniciarConfirmacion(result, [SPOTIFY]);

    expect(result.current.enCurso).toBe(true);
    expect(result.current.resultado).toBeNull();
    expect(alTerminar).not.toHaveBeenCalled();

    await act(async () => respuesta.resolver({ id: 'c-1', estado: 'confirmado' }));
    expect(result.current.enCurso).toBe(false);
    expect(result.current.resultado?.resultados).toEqual([{ id: 'c-1', nombre: 'Spotify', tipo: 'confirmado' }]);
  });

  it('un cobro que el servidor ya tenía confirmado (200 repetido) cuenta como confirmado, sin crear otro', async () => {
    simularRed({});
    const { result } = montar();

    await confirmar(result, [SPOTIFY]);
    await confirmar(result, [SPOTIFY]);

    expect(result.current.resultado?.resultados).toEqual([{ id: 'c-1', nombre: 'Spotify', tipo: 'confirmado' }]);
    expect(confirmaciones()).toHaveLength(2);
  });

  it('una lista vacía no manda nada ni avisa que terminó', async () => {
    simularRed({});
    const { result, alTerminar } = montar();

    await confirmar(result, []);

    expect(pedir).not.toHaveBeenCalledWith(expect.stringContaining('/confirmar/'), expect.anything());
    expect(result.current.resultado).toBeNull();
    expect(alTerminar).not.toHaveBeenCalled();
  });
});

describe('fallos parciales (S3-CH-08)', () => {
  it.each([
    ['candidato_rechazado', 'Está rechazado. Para confirmarlo hay que volver a importar el archivo.'],
    ['servicio_sin_resolver', 'No se reconoció el proveedor, así que no se puede crear la suscripción.'],
    ['tipo_sin_regla', 'No hay una regla para este tipo de cobro.'],
  ])('un 409 %s dice su motivo, sin repetir el texto técnico del servidor', async (codigo, mensajeEsperado) => {
    simularRed({ 'c-1': new ErrorDeApi('Texto técnico del servidor.', 409, { codigo: [codigo] }) });
    const { result } = montar();

    await confirmar(result, [SPOTIFY]);

    expect(result.current.resultado?.resultados).toEqual([{ id: 'c-1', nombre: 'Spotify', tipo: 'fallido', mensaje: mensajeEsperado }]);
  });

  it.each([
    ['sin red', new TypeError('Failed to fetch'), MENSAJE_SIN_RED],
    ['un 404', new ErrorDeApi('No encontrado.', 404), MENSAJE_COBRO_NO_ENCONTRADO],
    ['un 500', new ErrorDeApi('Error interno.', 500), MENSAJE_ERROR_AL_CONFIRMAR],
    ['un 409 con un código que no se conoce', new ErrorDeApi('Otro.', 409, { codigo: ['codigo_nuevo'] }), MENSAJE_ERROR_AL_CONFIRMAR],
  ])('%s da su mensaje', async (_descripcion, error, mensajeEsperado) => {
    simularRed({ 'c-1': error });
    const { result } = montar();

    await confirmar(result, [SPOTIFY]);

    expect(result.current.resultado?.resultados).toEqual([{ id: 'c-1', nombre: 'Spotify', tipo: 'fallido', mensaje: mensajeEsperado }]);
  });

  it('el fallo de un cobro no frena a los demás: se pide cada uno y cada uno tiene su resultado', async () => {
    simularRed({ 'c-1': new ErrorDeApi('Error interno.', 500) });
    const { result, alTerminar } = montar();

    await confirmar(result, [SPOTIFY, NETFLIX, SIN_NOMBRE]);

    expect(confirmaciones()).toHaveLength(3);
    expect(result.current.resultado?.resultados.map(({ id, tipo }) => [id, tipo])).toEqual([
      ['c-1', 'fallido'],
      ['c-2', 'confirmado'],
      ['c-3', 'confirmado'],
    ]);
    expect(alTerminar).toHaveBeenCalledTimes(1);
  });

  it('sin proveedor reconocido el cobro se nombra con el texto original, sin inventar un nombre', async () => {
    simularRed({});
    const { result } = montar();

    await confirmar(result, [SIN_NOMBRE]);

    expect(result.current.resultado?.resultados[0]).toMatchObject({ nombre: 'PAGO 4471' });
  });
});

describe('doble envío y resultado (S3-CH-08)', () => {
  it('un segundo envío mientras la tanda sigue en curso no manda otra confirmación', async () => {
    const respuesta = diferida<unknown>();
    simularRed({ 'c-1': respuesta.promesa });
    const { result } = montar();

    await act(async () => {
      result.current.confirmar([SPOTIFY]);
      result.current.confirmar([SPOTIFY]);
    });

    expect(confirmaciones()).toHaveLength(1);
    await act(async () => respuesta.resolver({ id: 'c-1' }));
  });

  it('terminada la tanda se puede confirmar otra', async () => {
    simularRed({});
    const { result } = montar();
    await confirmar(result, [SPOTIFY]);

    await confirmar(result, [NETFLIX]);

    expect(confirmaciones()).toHaveLength(2);
    expect(result.current.resultado?.resultados).toEqual([{ id: 'c-2', nombre: 'Netflix', tipo: 'confirmado' }]);
  });

  it('empezar otra tanda borra el resultado de la anterior', async () => {
    const segunda = diferida<unknown>();
    simularRed({ 'c-2': segunda.promesa });
    const { result } = montar();
    await confirmar(result, [SPOTIFY]);
    expect(result.current.resultado).not.toBeNull();

    await iniciarConfirmacion(result, [NETFLIX]);

    expect(result.current.resultado).toBeNull();
    await act(async () => segunda.resolver({ id: 'c-2' }));
  });

  it('cerrar el resultado lo quita', async () => {
    simularRed({});
    const { result } = montar();
    await confirmar(result, [SPOTIFY]);

    act(() => result.current.cerrarResultado());

    expect(result.current.resultado).toBeNull();
  });
});

describe('cambio de sesión con la confirmación en vuelo (regla de sesión de Integra III)', () => {
  it('la respuesta de A que llega con B ya dentro no se muestra ni avisa que terminó', async () => {
    const respuestaDeA = diferida<unknown>();
    simularRed({ 'c-1': respuestaDeA.promesa });
    const { result, alTerminar } = montar();
    await iniciarConfirmacion(result, [SPOTIFY]);
    await waitFor(() => expect(confirmaciones()).toHaveLength(1));

    await entraOtraSesion();
    await act(async () => respuestaDeA.resolver({ id: 'c-1', estado: 'confirmado' }));

    expect(result.current.resultado).toBeNull();
    expect(alTerminar).not.toHaveBeenCalled();
    expect(result.current.enCurso).toBe(false);
  });

  it('con la sesión ya cambiada no se manda ninguna confirmación', async () => {
    simularRed({});
    const { result } = montar();
    await entraOtraSesion();

    await confirmar(result, [SPOTIFY]);

    expect(confirmaciones()).toHaveLength(0);
    expect(result.current.enCurso).toBe(false);
  });

  it('un fallo de A que llega tarde tampoco aparece en la vista de B', async () => {
    const falloDeA = diferida<unknown>();
    vi.mocked(pedir).mockImplementation((ruta: string) =>
      /\/confirmar\/$/.test(ruta) ? falloDeA.promesa.then(() => Promise.reject(new TypeError('Failed to fetch'))) : Promise.resolve(PERSONA_ACTUAL),
    );
    const { result } = montar();
    await iniciarConfirmacion(result, [SPOTIFY]);

    await entraOtraSesion();
    await act(async () => falloDeA.resolver(undefined));

    expect(result.current.resultado).toBeNull();
  });
});

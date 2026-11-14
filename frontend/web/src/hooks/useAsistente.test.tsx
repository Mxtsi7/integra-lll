// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from '../../../shared/src/api/cliente';
import { LIMITE_PREGUNTA_ASISTENTE, type RespuestaAsistente } from '../../../shared/src/api/asistente';
import { guardarTokens } from '../../../shared/src/auth';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { crearTokenDePrueba } from '../test/tokensDePrueba';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import { useAsistente } from './useAsistente';

// Solo se simula la red (pedir): el cliente del asistente y el hook son los reales.
vi.mock('../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// El hook anota la sesión con la que se montó: necesita el AuthProvider real.
function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
const montarHook = () => renderHook(useAsistente, { wrapper: Proveedores });

const RESPUESTA_DEL_ASISTENTE: RespuestaAsistente = { estado: 'ok', motivo: null, respuesta: 'Revisa el streaming.' };
const RESPUESTA_DE_RESPALDO: RespuestaAsistente = {
  estado: 'degradado',
  motivo: 'timeout',
  respuesta: 'Registramos 120 minutos de uso.',
};

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

const enviar = (resultado: ReturnType<typeof montarHook>['result'], pregunta: string) =>
  act(async () => resultado.current.enviarPregunta(pregunta));

describe('envío de preguntas (S3-CH-15, VI-22)', () => {
  it('empieza sin mensajes y sin envío en curso', () => {
    const { result } = montarHook();
    expect(result.current.mensajes).toEqual([]);
    expect(result.current.envio).toEqual({ tipo: 'libre' });
  });

  it('manda POST /asistente/ con la pregunta y agrega la pregunta y la respuesta, en ese orden', async () => {
    vi.mocked(pedir).mockResolvedValue(RESPUESTA_DEL_ASISTENTE);
    const { result } = montarHook();

    await enviar(result, '¿Qué reviso primero?');

    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith('/asistente/', { method: 'POST', body: { mensaje: '¿Qué reviso primero?' } });
    expect(result.current.mensajes).toEqual([
      { id: 1, autor: 'persona', texto: '¿Qué reviso primero?' },
      { id: 2, autor: 'asistente', texto: 'Revisa el streaming.', esRespaldo: false },
    ]);
    expect(result.current.envio).toEqual({ tipo: 'libre' });
  });

  it('mientras espera la respuesta la pregunta ya se ve y el envío figura en curso', async () => {
    const respuestaPendiente = diferida<RespuestaAsistente>();
    vi.mocked(pedir).mockReturnValue(respuestaPendiente.promesa);
    const { result } = montarHook();

    await enviar(result, 'Hola');

    expect(result.current.mensajes).toEqual([{ id: 1, autor: 'persona', texto: 'Hola' }]);
    expect(result.current.envio).toEqual({ tipo: 'enviando' });

    await act(async () => respuestaPendiente.resolver(RESPUESTA_DEL_ASISTENTE));
    expect(result.current.mensajes).toHaveLength(2);
    expect(result.current.envio).toEqual({ tipo: 'libre' });
  });

  it('una respuesta degradada se muestra como respaldo, no como error', async () => {
    vi.mocked(pedir).mockResolvedValue(RESPUESTA_DE_RESPALDO);
    const { result } = montarHook();

    await enviar(result, 'Resumen');

    expect(result.current.mensajes[1]).toEqual({ id: 2, autor: 'asistente', texto: 'Registramos 120 minutos de uso.', esRespaldo: true });
    expect(result.current.envio).toEqual({ tipo: 'libre' });
  });

  it('recorta los espacios de la pregunta antes de mandarla', async () => {
    vi.mocked(pedir).mockResolvedValue(RESPUESTA_DEL_ASISTENTE);
    const { result } = montarHook();

    await enviar(result, '   ¿Cuánto gasto?  ');

    expect(pedir).toHaveBeenCalledWith('/asistente/', { method: 'POST', body: { mensaje: '¿Cuánto gasto?' } });
    expect(result.current.mensajes[0]).toMatchObject({ texto: '¿Cuánto gasto?' });
  });

  it.each([
    ['vacía', ''],
    ['solo espacios', '   \n  '],
    ['más larga que el máximo del backend', 'a'.repeat(LIMITE_PREGUNTA_ASISTENTE + 1)],
  ])('una pregunta %s no se manda ni se agrega', async (_descripcion, pregunta) => {
    const { result } = montarHook();

    await enviar(result, pregunta);

    expect(pedir).not.toHaveBeenCalled();
    expect(result.current.mensajes).toEqual([]);
  });

  it('una pregunta del largo máximo sí se manda', async () => {
    vi.mocked(pedir).mockResolvedValue(RESPUESTA_DEL_ASISTENTE);
    const { result } = montarHook();

    await enviar(result, 'a'.repeat(LIMITE_PREGUNTA_ASISTENTE));

    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('un segundo envío mientras el primero sigue pendiente no manda otra pregunta', async () => {
    const respuestaPendiente = diferida<RespuestaAsistente>();
    vi.mocked(pedir).mockReturnValue(respuestaPendiente.promesa);
    const { result } = montarHook();

    await enviar(result, 'Primera');
    await enviar(result, 'Segunda');

    expect(pedir).toHaveBeenCalledTimes(1);
    expect(result.current.mensajes).toEqual([{ id: 1, autor: 'persona', texto: 'Primera' }]);

    await act(async () => respuestaPendiente.resolver(RESPUESTA_DEL_ASISTENTE));
    // Con la respuesta ya recibida, el siguiente envío vuelve a funcionar.
    vi.mocked(pedir).mockResolvedValue(RESPUESTA_DEL_ASISTENTE);
    await enviar(result, 'Segunda');
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('dos envíos en el mismo instante, antes de que React pinte el estado, mandan una sola pregunta', async () => {
    vi.mocked(pedir).mockReturnValue(diferida<RespuestaAsistente>().promesa);
    const { result } = montarHook();

    await act(async () => {
      result.current.enviarPregunta('Doble Enter');
      result.current.enviarPregunta('Doble Enter');
    });

    expect(pedir).toHaveBeenCalledTimes(1);
    expect(result.current.mensajes).toHaveLength(1);
  });
});

describe('errores y reintento (S3-CH-15)', () => {
  it('sin red dice que no hay conexión y deja la pregunta en la conversación', async () => {
    vi.mocked(pedir).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = montarHook();

    await enviar(result, '¿Qué reviso primero?');

    expect(result.current.envio).toEqual({ tipo: 'error', mensaje: MENSAJE_SIN_RED, pregunta: '¿Qué reviso primero?' });
    expect(result.current.mensajes).toEqual([{ id: 1, autor: 'persona', texto: '¿Qué reviso primero?' }]);
  });

  it('un 403 dice que no hay acceso, sin repetir el texto técnico del servidor', async () => {
    vi.mocked(pedir).mockRejectedValue(new ErrorDeApi('Esta función requiere Premium vigente', 403));
    const { result } = montarHook();

    await enviar(result, 'Hola');

    expect(result.current.envio).toMatchObject({ tipo: 'error', mensaje: 'No tienes acceso al asistente financiero con tu cuenta.' });
  });

  it('cualquier otro fallo del servidor da un mensaje general', async () => {
    vi.mocked(pedir).mockRejectedValue(new ErrorDeApi('Internal Server Error', 500));
    const { result } = montarHook();

    await enviar(result, 'Hola');

    expect(result.current.envio).toMatchObject({ tipo: 'error', mensaje: 'El asistente no pudo responder. Intenta de nuevo.' });
  });

  it.each([
    ['sin texto', { estado: 'ok', motivo: null, respuesta: '' }],
    ['solo espacios', { estado: 'ok', motivo: null, respuesta: '   ' }],
    ['sin el campo respuesta', { estado: 'ok', motivo: null }],
    ['con un cuerpo que no es un objeto', null],
  ])('una respuesta %s no se muestra como mensaje vacío: es un error que se puede reintentar', async (_descripcion, cuerpo) => {
    vi.mocked(pedir).mockResolvedValue(cuerpo);
    const { result } = montarHook();

    await enviar(result, 'Hola');

    expect(result.current.mensajes).toEqual([{ id: 1, autor: 'persona', texto: 'Hola' }]);
    expect(result.current.envio).toEqual({
      tipo: 'error',
      mensaje: 'El asistente no devolvió una respuesta. Intenta de nuevo.',
      pregunta: 'Hola',
    });
  });

  it('reintentar manda otra vez la misma pregunta sin repetirla en la conversación', async () => {
    vi.mocked(pedir).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(RESPUESTA_DEL_ASISTENTE);
    const { result } = montarHook();
    await enviar(result, '¿Qué reviso primero?');

    await act(async () => result.current.reintentar());

    expect(pedir).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pedir).mock.calls[1]).toEqual(['/asistente/', { method: 'POST', body: { mensaje: '¿Qué reviso primero?' } }]);
    expect(result.current.mensajes).toEqual([
      { id: 1, autor: 'persona', texto: '¿Qué reviso primero?' },
      { id: 2, autor: 'asistente', texto: 'Revisa el streaming.', esRespaldo: false },
    ]);
    expect(result.current.envio).toEqual({ tipo: 'libre' });
  });

  it('un reintento que vuelve a fallar deja el error y se puede intentar otra vez', async () => {
    vi.mocked(pedir).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = montarHook();
    await enviar(result, 'Hola');

    await act(async () => result.current.reintentar());
    expect(result.current.envio).toMatchObject({ tipo: 'error', pregunta: 'Hola' });

    vi.mocked(pedir).mockResolvedValue(RESPUESTA_DEL_ASISTENTE);
    await act(async () => result.current.reintentar());
    expect(result.current.envio).toEqual({ tipo: 'libre' });
    expect(result.current.mensajes).toHaveLength(2);
  });

  it('durante el reintento figura como envío en curso y un segundo reintento no manda otra pregunta', async () => {
    vi.mocked(pedir).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = montarHook();
    await enviar(result, 'Hola');

    const reintentoPendiente = diferida<RespuestaAsistente>();
    vi.mocked(pedir).mockReturnValue(reintentoPendiente.promesa);
    await act(async () => {
      result.current.reintentar();
      result.current.reintentar();
    });

    expect(result.current.envio).toEqual({ tipo: 'enviando' });
    expect(pedir).toHaveBeenCalledTimes(2);
    await act(async () => reintentoPendiente.resolver(RESPUESTA_DEL_ASISTENTE));
  });

  it('reintentar sin un error previo no hace nada', async () => {
    const { result } = montarHook();

    await act(async () => result.current.reintentar());

    expect(pedir).not.toHaveBeenCalled();
    expect(result.current.envio).toEqual({ tipo: 'libre' });
  });

  it('después de un error se puede enviar una pregunta nueva', async () => {
    vi.mocked(pedir).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(RESPUESTA_DEL_ASISTENTE);
    const { result } = montarHook();
    await enviar(result, 'Primera');

    await enviar(result, 'Segunda');

    expect(result.current.envio).toEqual({ tipo: 'libre' });
    expect(result.current.mensajes.map((mensaje) => mensaje.texto)).toEqual(['Primera', 'Segunda', 'Revisa el streaming.']);
  });
});

describe('cambio de sesión con el hook todavía montado (regla de sesión de Integra III)', () => {
  // En la app, <RutaPrivada> vuelve a montar la página al cambiar de sesión y React descarta lo que
  // le llegue a la versión vieja. Aquí el hook sigue montado, para comprobar que él mismo no aplica
  // ni manda nada de otra sesión (por ejemplo, si alguien lo usa fuera de esa guarda).
  const TOKEN_DE_A = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
  const TOKEN_DE_B = crearTokenDePrueba({ user_id: 8, organizacion_id: 'org-b', sid: 'sesion-b', jti: 'b-1' });
  const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };

  // El AuthProvider con sesión pide /usuarios/me/ por la misma función: solo el asistente responde lo que quiera el test.
  function simularRed(respuestaDelAsistente: () => Promise<RespuestaAsistente>) {
    vi.mocked(pedir).mockImplementation((ruta: string) =>
      ruta === '/asistente/' ? respuestaDelAsistente() : Promise.resolve(PERSONA_ACTUAL),
    );
  }
  const consultasAlAsistente = () => vi.mocked(pedir).mock.calls.filter(([ruta]) => ruta === '/asistente/');

  /** Otra pestaña guarda los tokens de B: a esta solo le llega el evento `storage`. */
  const entraOtraSesion = () =>
    act(async () => {
      guardarTokens({ access_token: TOKEN_DE_B, refresh_token: 'refresh-b' });
      window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
    });

  beforeEach(() => {
    localStorage.clear();
    guardarTokens({ access_token: TOKEN_DE_A, refresh_token: 'refresh-a' });
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('la respuesta de A que llega cuando ya entró B no se agrega a la conversación', async () => {
    const respuestaDeA = diferida<RespuestaAsistente>();
    simularRed(() => respuestaDeA.promesa);
    const { result } = montarHook();
    await enviar(result, 'Pregunta de A');
    await entraOtraSesion();

    await act(async () => respuestaDeA.resolver(RESPUESTA_DEL_ASISTENTE));

    expect(result.current.mensajes).toEqual([{ id: 1, autor: 'persona', texto: 'Pregunta de A' }]);
  });

  it('el error de A que llega cuando ya entró B no se muestra', async () => {
    const respuestaDeA = diferida<RespuestaAsistente>();
    simularRed(() => respuestaDeA.promesa);
    const { result } = montarHook();
    await enviar(result, 'Pregunta de A');
    await entraOtraSesion();

    await act(async () => respuestaDeA.rechazar(new TypeError('Failed to fetch')));

    expect(result.current.envio.tipo).not.toBe('error');
  });

  it('con la sesión ya cambiada no se manda la pregunta', async () => {
    simularRed(async () => RESPUESTA_DEL_ASISTENTE);
    const { result } = montarHook();
    await entraOtraSesion();

    await enviar(result, 'Pregunta con la sesión vieja');

    expect(consultasAlAsistente()).toHaveLength(0);
    expect(result.current.mensajes).toEqual([]);
  });

  it('con la sesión ya cambiada tampoco se reintenta la pregunta que falló', async () => {
    simularRed(() => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = montarHook();
    await enviar(result, 'Pregunta de A');
    expect(result.current.envio.tipo).toBe('error');
    await entraOtraSesion();

    await act(async () => result.current.reintentar());

    expect(consultasAlAsistente()).toHaveLength(1);
  });
});

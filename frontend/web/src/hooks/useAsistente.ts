import { useCallback, useEffect, useRef, useState } from 'react';
import { consultarAsistente, ErrorDeApi, LIMITE_PREGUNTA_ASISTENTE, type RespuestaAsistente } from '@ojoalgasto/shared';
import type { MensajeChat } from '../components/asistente/mensajesChat';
import { useAuth } from '../context/AuthContext';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

/** Cómo va el envío de la pregunta (S3-CH-15). */
export type EstadoEnvio =
  | { tipo: 'libre' }
  | { tipo: 'enviando' }
  // Guarda la pregunta para poder reintentarla sin escribirla ni mostrarla otra vez.
  | { tipo: 'error'; mensaje: string; pregunta: string };

// La conversación y el envío cambian juntos (la pregunta se agrega y a la vez
// se empieza a esperar), por eso van en un solo estado.
interface Conversacion {
  mensajes: MensajeChat[];
  envio: EstadoEnvio;
}

const MENSAJE_SIN_ACCESO = 'No tienes acceso al asistente financiero con tu cuenta.';
const MENSAJE_SIN_RESPUESTA = 'El asistente no devolvió una respuesta. Intenta de nuevo.';
const MENSAJE_ERROR_GENERAL = 'El asistente no pudo responder. Intenta de nuevo.';
const MENSAJE_TARDO_DEMASIADO = 'El asistente tardó demasiado en responder. Intenta de nuevo.';
const MENSAJE_SERVICIO_NO_DISPONIBLE = 'El asistente no está disponible ahora. Intenta de nuevo en unos minutos.';

// Qué decir según el estado HTTP con que responde el gateway (S3-CH-17):
// - 403: el plan no incluye el asistente. La restricción Premium completa y el
//   límite de consultas son de S3-CH-16.
// - 502: el servicio del asistente no está disponible.
// - 503: no se pudo comprobar la sesión o los permisos.
// - 504: el servicio del asistente no respondió a tiempo.
const MENSAJE_POR_ESTADO_HTTP = new Map<number, string>([
  [403, MENSAJE_SIN_ACCESO],
  [502, MENSAJE_SERVICIO_NO_DISPONIBLE],
  [503, MENSAJE_SERVICIO_NO_DISPONIBLE],
  [504, MENSAJE_TARDO_DEMASIADO],
]);

function mensajeDeError(error: unknown): string {
  if (error instanceof TypeError) return MENSAJE_SIN_RED;
  if (error instanceof ErrorDeApi) return MENSAJE_POR_ESTADO_HTTP.get(error.status) ?? MENSAJE_ERROR_GENERAL;
  return MENSAJE_ERROR_GENERAL;
}

/** Por qué el asistente con IA no contestó; null si contestó o la API no lo dice. */
function motivoDeRespaldo(respuesta: RespuestaAsistente): string | null {
  return typeof respuesta.motivo === 'string' ? respuesta.motivo : null;
}

/** El texto de la respuesta, o null si la API no trajo nada que mostrar. */
function textoDeLaRespuesta(respuesta: RespuestaAsistente | null | undefined): string | null {
  const texto = respuesta?.respuesta;
  return typeof texto === 'string' && texto.trim() !== '' ? texto : null;
}

/**
 * S3-CH-15: manda las preguntas del chat al asistente (POST /api/asistente/) y
 * va armando la conversación. Cada pregunta se responde sola: el historial es
 * solo de la vista y el backend no lo recibe.
 */
export function useAsistente() {
  const { capturarSesion } = useAuth();
  // La sesión con la que se montó la página. Si cambia, <RutaPrivada> la vuelve
  // a montar desde cero; esto cubre la respuesta que llega entre el cambio y
  // ese nuevo montaje, o con la página ya cerrada: no se muestra.
  const [sesion] = useState(capturarSesion);
  const montado = useRef(false);
  const sigueVigente = useCallback(() => montado.current && capturarSesion() === sesion, [capturarSesion, sesion]);

  const [conversacion, setConversacion] = useState<Conversacion>({ mensajes: [], envio: { tipo: 'libre' } });
  // Ref y no solo estado: un doble Enter vería el estado viejo y mandaría dos preguntas.
  const hayEnvioEnCurso = useRef(false);
  const ultimoIdDeMensaje = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      // Al desmontar, la respuesta en vuelo ya no se muestra.
      montado.current = false;
    };
  }, []);

  const pedirRespuesta = useCallback(
    async (pregunta: string) => {
      hayEnvioEnCurso.current = true;
      setConversacion((actual) => ({ ...actual, envio: { tipo: 'enviando' } }));
      try {
        const respuesta = await consultarAsistente(pregunta);
        if (!sigueVigente()) return;
        const texto = textoDeLaRespuesta(respuesta);
        if (texto === null) {
          setConversacion((actual) => ({ ...actual, envio: { tipo: 'error', mensaje: MENSAJE_SIN_RESPUESTA, pregunta } }));
          return;
        }
        ultimoIdDeMensaje.current += 1;
        const mensajeDelAsistente: MensajeChat = {
          id: ultimoIdDeMensaje.current,
          autor: 'asistente',
          texto,
          respaldo: respuesta.estado === 'ok' ? null : { motivo: motivoDeRespaldo(respuesta) },
        };
        setConversacion((actual) => ({ mensajes: [...actual.mensajes, mensajeDelAsistente], envio: { tipo: 'libre' } }));
      } catch (error: unknown) {
        if (!sigueVigente()) return;
        setConversacion((actual) => ({ ...actual, envio: { tipo: 'error', mensaje: mensajeDeError(error), pregunta } }));
      } finally {
        hayEnvioEnCurso.current = false;
      }
    },
    [sigueVigente],
  );

  /** Agrega la pregunta a la conversación y pide la respuesta. No hace nada si ya hay un envío en curso. */
  const enviarPregunta = useCallback(
    (texto: string) => {
      const pregunta = texto.trim();
      if (pregunta === '' || pregunta.length > LIMITE_PREGUNTA_ASISTENTE) return;
      if (!sigueVigente() || hayEnvioEnCurso.current) return;
      ultimoIdDeMensaje.current += 1;
      const mensajeDeLaPersona: MensajeChat = { id: ultimoIdDeMensaje.current, autor: 'persona', texto: pregunta };
      setConversacion((actual) => ({ ...actual, mensajes: [...actual.mensajes, mensajeDeLaPersona] }));
      pedirRespuesta(pregunta);
    },
    [sigueVigente, pedirRespuesta],
  );

  /** Vuelve a pedir la respuesta de la última pregunta que falló, sin repetirla en la conversación. */
  const reintentar = useCallback(() => {
    const { envio } = conversacion;
    if (envio.tipo !== 'error' || !sigueVigente() || hayEnvioEnCurso.current) return;
    pedirRespuesta(envio.pregunta);
  }, [conversacion, sigueVigente, pedirRespuesta]);

  return { mensajes: conversacion.mensajes, envio: conversacion.envio, enviarPregunta, reintentar };
}

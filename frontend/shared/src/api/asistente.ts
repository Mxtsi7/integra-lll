import { pedir } from './cliente';

/** El largo máximo de la pregunta que acepta el backend (ConsultaAsistenteSerializer, VI-22). */
export const LIMITE_PREGUNTA_ASISTENTE = 500;

/**
 * La respuesta de POST /api/asistente/ (VI-22).
 *
 * `estado: 'degradado'` es la respuesta de respaldo: el asistente con IA no
 * contestó y `respuesta` es un resumen que el backend calcula con los mismos
 * datos. La API manda también `datos` (el contexto con el que respondió); la
 * web no lo usa y por eso no se tipa.
 */
export interface RespuestaAsistente {
  estado: 'ok' | 'degradado';
  /**
   * Por qué se degradó (null cuando contestó el asistente): no_configurado,
   * timeout, proveedor_no_disponible, cuota_agotada, capacidad,
   * cuota_no_disponible o respuesta_invalida.
   */
  motivo: string | null;
  respuesta: string;
}

/**
 * S3-CH-15 (POST /api/asistente/): manda la pregunta al asistente financiero.
 * El gateway exige el plan Premium: sin él responde 403. Con el proveedor caído
 * o la cuota agotada la API igual responde 200, con `estado: 'degradado'`.
 */
export async function consultarAsistente(pregunta: string): Promise<RespuestaAsistente> {
  return await pedir('/asistente/', { method: 'POST', body: { mensaje: pregunta } });
}

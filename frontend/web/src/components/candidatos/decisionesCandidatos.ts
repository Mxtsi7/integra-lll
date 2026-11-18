import { ErrorDeApi, type CodigoConfirmacionRechazada, type CodigoRechazoNoPermitido } from '@ojoalgasto/shared';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';

/** Qué se pidió a una tanda de cobros: confirmarlos (S3-CH-08) o rechazarlos (S3-CH-09). */
export type AccionDeCandidato = 'confirmar' | 'rechazar';

/**
 * Cómo salió la decisión sobre un cobro. Solo `hecho` cuenta como éxito: el servidor
 * respondió 200. Nada se marca antes de esa respuesta.
 */
export type ResultadoPorCandidato =
  | { id: string; nombre: string; tipo: 'hecho' }
  | { id: string; nombre: string; tipo: 'fallido'; mensaje: string };

/** Lo que dejó la última tanda: qué se pidió y cómo salió cada cobro. */
export interface ResultadoDecisiones {
  accion: AccionDeCandidato;
  resultados: readonly ResultadoPorCandidato[];
}

/** Lo que la lista necesita de las decisiones; lo arma la página con `useDecisionesDeCandidatos`. */
export interface DecisionesDeCandidatos {
  /** La tanda que corre, o null. Mientras corre, ningún botón de decisión se puede pulsar. */
  accionEnCurso: AccionDeCandidato | null;
  /** La última tanda terminada; null si no hay una que mostrar. */
  resultado: ResultadoDecisiones | null;
  /** Confirma los cobros seleccionados que tienen proveedor reconocido. */
  alConfirmar: () => void;
  /** Rechaza todos los cobros seleccionados, tengan o no proveedor. */
  alRechazar: () => void;
  alCerrarResultado: () => void;
}

const MENSAJE_POR_CODIGO_DE_CONFIRMACION: Record<CodigoConfirmacionRechazada, string> = {
  candidato_rechazado: 'Está rechazado. Para confirmarlo hay que volver a importar el archivo.',
  servicio_sin_resolver: 'No se reconoció el proveedor, así que no se puede crear la suscripción.',
  tipo_sin_regla: 'No hay una regla para este tipo de cobro.',
};
export const MENSAJE_YA_CONFIRMADO = 'Ya está confirmado: desde aquí no se puede rechazar.';
export const MENSAJE_COBRO_NO_ENCONTRADO = 'Ya no existe: puede que se haya eliminado la importación.';
export const MENSAJE_ERROR_AL_CONFIRMAR = 'No se pudo confirmar. Inténtalo de nuevo.';
export const MENSAJE_ERROR_AL_RECHAZAR = 'No se pudo rechazar. Inténtalo de nuevo.';

/** Lo que significa un fallo para las dos decisiones: sin red, un 404 o un error general. */
function mensajeDeFalloComun(error: unknown, mensajeGeneral: string): string {
  if (error instanceof TypeError) return MENSAJE_SIN_RED;
  if (error instanceof ErrorDeApi && error.status === 404) return MENSAJE_COBRO_NO_ENCONTRADO;
  return mensajeGeneral;
}

/** Qué decir de un cobro que no se pudo confirmar, según lo que respondió el servidor. */
export function mensajeDeFalloAlConfirmar(error: unknown, codigo: CodigoConfirmacionRechazada | null): string {
  if (codigo !== null) return MENSAJE_POR_CODIGO_DE_CONFIRMACION[codigo];
  return mensajeDeFalloComun(error, MENSAJE_ERROR_AL_CONFIRMAR);
}

/** Qué decir de un cobro que no se pudo rechazar. El único código es `candidato_ya_confirmado`. */
export function mensajeDeFalloAlRechazar(error: unknown, codigo: CodigoRechazoNoPermitido | null): string {
  if (codigo !== null) return MENSAJE_YA_CONFIRMADO;
  return mensajeDeFalloComun(error, MENSAJE_ERROR_AL_RECHAZAR);
}

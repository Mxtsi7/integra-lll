import { ErrorDeApi, type CodigoConfirmacionRechazada } from '@ojoalgasto/shared';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';

/** Cómo salió confirmar un cobro. Solo `confirmado` es éxito: el servidor respondió 200 (S3-CH-08). */
export type ResultadoPorCandidato =
  | { id: string; nombre: string; tipo: 'confirmado' }
  | { id: string; nombre: string; tipo: 'fallido'; mensaje: string };

/** Lo que dejó la última tanda de confirmaciones. */
export interface ResultadoConfirmacion {
  resultados: readonly ResultadoPorCandidato[];
}

/** Lo que la lista necesita saber de la confirmación; lo arma `useConfirmacionCandidatos`. */
export interface ConfirmacionDeCandidatos {
  enCurso: boolean;
  /** La última tanda terminada; null si no hay una que mostrar. */
  resultado: ResultadoConfirmacion | null;
  /** Confirma los cobros seleccionados que se pueden confirmar. */
  alConfirmar: () => void;
  alCerrarResultado: () => void;
}

const MENSAJE_POR_CODIGO: Record<CodigoConfirmacionRechazada, string> = {
  candidato_rechazado: 'Está rechazado. Para confirmarlo hay que volver a importar el archivo.',
  servicio_sin_resolver: 'No se reconoció el proveedor, así que no se puede crear la suscripción.',
  tipo_sin_regla: 'No hay una regla para este tipo de cobro.',
};
export const MENSAJE_COBRO_NO_ENCONTRADO = 'Ya no existe: puede que se haya eliminado la importación.';
export const MENSAJE_ERROR_AL_CONFIRMAR = 'No se pudo confirmar. Inténtalo de nuevo.';

/** Qué decir de un cobro que no se pudo confirmar, según lo que respondió el servidor. */
export function mensajeDeFalloAlConfirmar(error: unknown, codigo: CodigoConfirmacionRechazada | null): string {
  if (codigo !== null) return MENSAJE_POR_CODIGO[codigo];
  if (error instanceof TypeError) return MENSAJE_SIN_RED;
  if (error instanceof ErrorDeApi && error.status === 404) return MENSAJE_COBRO_NO_ENCONTRADO;
  return MENSAJE_ERROR_AL_CONFIRMAR;
}

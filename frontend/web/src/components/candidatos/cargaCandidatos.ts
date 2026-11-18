import type { CandidatoDetectado, Paginado } from '@ojoalgasto/shared';

/**
 * Cómo va la carga de la lista de candidatos (S3-CH-04). Igual que `EstadoCarga`
 * (AN-28), mientras carga o tras un error no hay datos: no puede quedar visible
 * una lista de antes. El error trae el mensaje de lo que pasó (sin red o el resto).
 */
export type CargaCandidatos =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; datos: Paginado<CandidatoDetectado> };

import type { EventoSuscripcionEstadoNormalizado } from '../dominio/suscripcion-estado.dto';

/**
 * Resultado de proyectar un `suscripcion.estado_cambiado`.
 *
 * - `aplicado`: el hecho era nuevo y actualizó el estado vigente.
 * - `duplicado`: la misma clave y el mismo contenido; no repite efectos.
 * - `obsoleto`: el hecho es nuevo para el inbox pero más viejo que el estado
 *   vigente; se registra para auditoría y no retrocede la proyección.
 * - `ignorado`: la organización ya fue eliminada; se ACK sin escribir.
 */
export type ResultadoProyeccionSuscripcion =
  | 'aplicado'
  | 'duplicado'
  | 'obsoleto'
  | 'ignorado';

export interface RepositorioSuscripcion {
  registrar(
    evento: EventoSuscripcionEstadoNormalizado,
  ): Promise<ResultadoProyeccionSuscripcion>;
}

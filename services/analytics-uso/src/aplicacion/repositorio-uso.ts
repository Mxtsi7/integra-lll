import type { EventoUsoNormalizado } from '../dominio/uso-recolectores.dto';

/**
 * S3-VI-11: resultado de aplicar un evento.
 *
 * `aplicado` es la primera aceptación. `duplicado` es la misma clave lógica y
 * el mismo contenido/destino: se confirma sin repetir efectos. Un conflicto
 * se representa con `ErrorConflictoEvento` y no se reintenta.
 */
export type ResultadoRegistroUso = 'aplicado' | 'duplicado';

export interface RepositorioUso {
  /**
   * Persiste el evento y recalcula los agregados del día y del mes en una sola
   * transacción. Debe ser seguro ante redelivery y carreras concurrentes.
   */
  registrar(evento: EventoUsoNormalizado): Promise<ResultadoRegistroUso>;
}

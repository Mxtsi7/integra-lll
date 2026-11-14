import type { EventoUsoNormalizado } from '../dominio/uso-recolectores.dto';

/**
 * S3-VI-11: resultado de aplicar un evento.
 *
 * `aplicado` es la primera aceptación. `duplicado` es la misma clave lógica y
 * el mismo contenido/destino: se confirma sin repetir efectos. `ignorado` es
 * un evento de una organización ya eliminada: la limpieza ganó la carrera, no
 * se reinserta nada y el mensaje se ACK sin ir a la DLQ. Un conflicto se
 * representa con `ErrorConflictoEvento` y no se reintenta.
 */
export type ResultadoRegistroUso = 'aplicado' | 'duplicado' | 'ignorado';

export interface RepositorioUso {
  /**
   * Persiste el evento y recalcula los agregados del día y del mes en una sola
   * transacción. Debe ser seguro ante redelivery y carreras concurrentes.
   */
  registrar(evento: EventoUsoNormalizado): Promise<ResultadoRegistroUso>;
}

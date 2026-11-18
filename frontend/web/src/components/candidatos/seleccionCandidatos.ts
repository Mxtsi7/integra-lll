import type { CandidatoDetectado } from '@ojoalgasto/shared';

/**
 * S3-CH-07: solo un cobro `propuesto` espera una decisión. Uno confirmado o
 * rechazado ya está resuelto y no queda como pendiente seleccionable.
 */
export function sePuedeDecidir(candidato: CandidatoDetectado): boolean {
  return candidato.estado === 'propuesto';
}

/**
 * Confirmar necesita un proveedor reconocido: sin él el servidor responde 409
 * `servicio_sin_resolver`, porque una suscripción con la glosa del banco no es
 * un dato. Rechazar no lo necesita. Es un aviso para quien elige: el servidor
 * es quien decide.
 */
export function sePuedeConfirmar(candidato: CandidatoDetectado): boolean {
  return sePuedeDecidir(candidato) && candidato.servicio !== null;
}

/** Lo que la lista necesita saber de la selección; lo arma `useSeleccionCandidatos`. */
export interface SeleccionDeCandidatos {
  /** Los seleccionados que siguen visibles y esperan una decisión. Son los que se rechazarían. */
  seleccionados: ReadonlySet<string>;
  /** De los seleccionados, los que se pueden confirmar: los que tienen proveedor reconocido. */
  idsParaConfirmar: readonly string[];
  /** Cuántos cobros de la página esperan una decisión: los que tienen casilla. */
  cantidadSeleccionable: number;
  alAlternar: (id: string) => void;
  alAlternarPagina: () => void;
  alLimpiar: () => void;
}

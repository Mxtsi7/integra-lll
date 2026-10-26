// Contrato común de estados de carga para pantallas (AN-28).
// Vive en shared para poder probarlo con vitest (la app móvil no tiene ejecutor de pruebas).

/** Estado de una carga. Cuando falla o carga NO hay `datos`: no puede quedar información de antes. */
export type EstadoCarga<T> = { tipo: 'cargando' } | { tipo: 'error' } | { tipo: 'listo'; datos: T };

export type VistaDeCarga = 'cargando' | 'error' | 'vacio' | 'listo';

/**
 * Qué se debe mostrar para un estado. `esVacio` solo se evalúa con datos listos:
 * mientras carga o tras un error nunca se mira ni se toca ningún dato.
 */
export function vistaDeEstado<T>(estado: EstadoCarga<T>, esVacio?: (datos: T) => boolean): VistaDeCarga {
  if (estado.tipo === 'cargando') return 'cargando';
  if (estado.tipo === 'error') return 'error';
  return esVacio?.(estado.datos) ? 'vacio' : 'listo';
}

import { formatearMonto, type Recomendacion } from '@ojoalgasto/shared';

export interface ListaLeida {
  recomendaciones: Recomendacion[];
  /** false: el backend no tiene con qué recomendar (falta configurar el umbral de ahorro). */
  disponible: boolean;
  /** Por qué no hay sugerencias, tal como lo explica el backend. */
  motivoSinSugerencias: string | null;
}

/**
 * El backend responde `{ results, disponible, motivo_sin_sugerencias }`; también se acepta un arreglo suelto.
 * Cualquier otra forma devuelve null: es un error de la API, NO una lista vacía.
 */
export function leerListaRecomendaciones(respuesta: unknown): ListaLeida | null {
  if (Array.isArray(respuesta)) {
    return { recomendaciones: respuesta as Recomendacion[], disponible: true, motivoSinSugerencias: null };
  }
  if (typeof respuesta !== 'object' || respuesta === null) return null;

  const { results, disponible, motivo_sin_sugerencias: motivo } = respuesta as Record<string, unknown>;
  if (!Array.isArray(results)) return null;
  return {
    recomendaciones: results as Recomendacion[],
    disponible: disponible !== false, // si no lo dice, no se asume que falta configuración
    motivoSinSugerencias: typeof motivo === 'string' && motivo !== '' ? motivo : null,
  };
}

/** "$9.900", o null si la recomendación no trae ahorro. La moneda se respeta tal cual llega. */
export function formatearAhorro(ahorro: number | undefined | null, moneda: string | undefined): string | null {
  if (typeof ahorro !== 'number') return null;
  try {
    return formatearMonto(ahorro, moneda || 'CLP');
  } catch {
    // Un código de moneda desconocido haría fallar a Intl: se muestra el número con su código.
    return `${moneda ?? ''} ${ahorro}`.trim();
  }
}

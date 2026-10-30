import { pedir } from './cliente';

/**
 * VI-17 (GET /api/recomendaciones/) ya está en main (PR #105) y el gateway la
 * enruta a Analytics: /recomendaciones muestra la página real. Se deja la
 * bandera por si hay que volver a "Próximamente" sin tocar las rutas.
 */
export const RECOMENDACIONES_DISPONIBLES = true;

/** Una recomendación de consolidación (RecomendacionConsolidacionSerializer de VI-17). */
export interface Recomendacion {
  id: string;
  suscripcion_id?: string;
  /** Nombre de la suscripción a la que se refiere. */
  nombre?: string;
  categoria?: string;
  motivo?: string;
  /** Llega como número (el serializer usa coerce_to_string=False). */
  ahorro_estimado?: number;
  moneda?: string;
}

/** La respuesta de GET /api/recomendaciones/ (ListaRecomendacionesSerializer). */
export interface ListaRecomendaciones {
  results: Recomendacion[];
  total?: number;
  /** false si Analytics no tiene umbral de ahorro configurado: no puede recomendar nada. */
  disponible?: boolean;
  /** Por qué no hay sugerencias (null cuando sí hay). Lo escribe el backend para mostrarlo. */
  motivo_sin_sugerencias?: string | null;
}

export async function getRecomendaciones(): Promise<ListaRecomendaciones | Recomendacion[]> {
  return await pedir('/recomendaciones/');
}

/** Confirmación de POST .../dismiss/ (RecomendacionDescartadaSerializer de VI-18). */
export interface RecomendacionDescartada {
  recomendacion_id: string;
  /** Hasta cuándo no se vuelve a mostrar (ISO con hora). */
  vigente_hasta: string | null;
  descartado: true;
}

/**
 * CH-32: "No me interesa" (VI-18). Sin cuerpo: el backend usa su vigencia por
 * omisión. Es idempotente: repetirlo renueva la misma fila, no duplica.
 */
export async function descartarRecomendacion(id: string): Promise<RecomendacionDescartada> {
  return await pedir(`/recomendaciones/${encodeURIComponent(id)}/dismiss/`, { method: 'POST' });
}

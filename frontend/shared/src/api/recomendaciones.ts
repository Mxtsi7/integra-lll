import { pedir } from './cliente';

/**
 * VI-17 (GET /api/recomendaciones/) todavía no está en main: Analytics no expone esa ruta.
 * Mientras sea false, /recomendaciones muestra "Próximamente". Al integrar VI-17: true.
 */
export const RECOMENDACIONES_DISPONIBLES = false;

export interface Recomendacion {
  id: string;
  suscripcion_id?: string;
  motivo?: string;
  ahorro_estimado?: number;
  moneda?: string;
}

export async function getRecomendaciones(): Promise<{ results: Recomendacion[] } | Recomendacion[]> {
  return await pedir('/recomendaciones/');
}

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

export interface ExplicacionRecomendacion {
  id: string;
  suscripcion_id: string;
  explicacion: string;
  fuente: 'reglas';
  estado: 'disponible' | 'datos_insuficientes';
  motivo: string | null;
  ahorro_estimado: number | null;
  moneda: string;
  base_calculo: string | null;
  evidencia: { id: string; url: string; descripcion: string } | null;
  uso: 'no_evaluado';
  advertencia_uso: string;
}

export async function explicarRecomendacion(id: string): Promise<ExplicacionRecomendacion> {
  return await pedir(`/recomendaciones/${encodeURIComponent(id)}/explicar/`);
}

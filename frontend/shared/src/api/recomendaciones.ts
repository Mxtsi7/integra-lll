import { pedir } from './cliente';

export interface Recomendacion {
  id: string;
  suscripcion_id?: string;
  motivo?: string;
  ahorro_estimado?: number;
  moneda?: string;
  // ...otros campos
}

export async function getRecomendaciones(): Promise<{ results: Recomendacion[] } | Recomendacion[]> {
  return await pedir('/recomendaciones/');
}

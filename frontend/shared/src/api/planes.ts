import { pedir } from './cliente';

export type CodigoPlan = 'free' | 'premium';
export interface FeaturesPlan {
  asistente_financiero: boolean;
  recomendaciones_automaticas: boolean;
}
export interface PermisosPlan {
  plan: CodigoPlan;
  features: FeaturesPlan;
}
export interface PlanDisponible {
  codigo: CodigoPlan;
  nombre: string;
  /** Decimal de la API; no se convierte a punto flotante para contratar. */
  precio: string;
  moneda: string;
  periodo: 'mensual';
  precio_demo: boolean;
  features: FeaturesPlan;
}

/** Releer tras contratar/cancelar; los claims no conceden permisos. */
export const getPermisosPlan = () => pedir<PermisosPlan>('/usuarios/me/permisos/');
export const getPlanes = () => pedir<PlanDisponible[]>('/planes/');

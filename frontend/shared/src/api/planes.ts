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

export interface ContratacionPlan {
  permisos: PermisosPlan;
  id: string;
  estado: 'pendiente' | 'exitosa' | 'cancelada' | 'fallida';
  plan_id: CodigoPlan;
  importe: string;
  moneda: string;
  precio_demo: boolean;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  url_checkout: string;
  url_retorno: string;
}

/** Reutilizar la misma clave UUID al reintentar. El servidor fija el precio. */
export const iniciarContratacion = (clave_idempotencia: string) =>
  pedir<ContratacionPlan>('/contrataciones/', {
    method: 'POST', body: { plan_codigo: 'premium', clave_idempotencia },
  });
export const getContratacion = (id: string) =>
  pedir<ContratacionPlan>(`/contrataciones/${encodeURIComponent(id)}/`);
export const cancelarContratacion = (id: string) =>
  pedir<ContratacionPlan>(`/contrataciones/${encodeURIComponent(id)}/cancelar/`, { method: 'POST' });

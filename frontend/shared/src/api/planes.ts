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

/** Nombres legibles de cada función Premium (MX-09, SE-02). */
export const NOMBRES_FEATURES: Record<keyof FeaturesPlan, string> = {
  asistente_financiero: 'Asistente financiero',
  recomendaciones_automaticas: 'Recomendaciones automáticas',
};

export const FEATURES_PREMIUM: (keyof FeaturesPlan)[] = [
  'asistente_financiero',
  'recomendaciones_automaticas',
];

/**
 * Valida la respuesta de `/usuarios/me/permisos/`. Si no tiene la forma esperada devuelve null.
 * Lo desconocido nunca se toma por permitido (seguro por defecto).
 */
export function leerPermisos(respuesta: unknown): PermisosPlan | null {
  if (typeof respuesta !== 'object' || respuesta === null) return null;
  const { plan, features } = respuesta as Partial<PermisosPlan>;
  if (plan !== 'free' && plan !== 'premium') return null;
  if (typeof features !== 'object' || features === null) return null;
  return {
    plan,
    features: {
      asistente_financiero: features.asistente_financiero === true,
      recomendaciones_automaticas: features.recomendaciones_automaticas === true,
    },
  };
}

/** ¿Este conjunto de permisos incluye la función solicitada? Solo true explícito concede acceso. */
export function incluyeFeature(
  permisos: { features: FeaturesPlan } | null | undefined,
  feature: keyof FeaturesPlan,
): boolean {
  if (!permisos || !permisos.features) return false;
  return permisos.features[feature] === true;
}

/** Valida si el plan corresponde a Premium. */
export function esPlanPremium(plan: string | null | undefined): boolean {
  return plan === 'premium';
}

/** Nombre legible del plan para la interfaz (evita texto fijo hardcodeado). */
export function describirPlan(plan: string | null | undefined): string {
  return esPlanPremium(plan) ? 'Plan Premium' : 'Plan Gratuito';
}

/** Detalle de beneficios del plan para la interfaz. */
export function describirDetallePlan(plan: string | null | undefined): string {
  return esPlanPremium(plan)
    ? 'Asistente financiero y recomendaciones avanzadas.'
    : 'Alertas de cobro y de prueba gratis incluidas.';
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

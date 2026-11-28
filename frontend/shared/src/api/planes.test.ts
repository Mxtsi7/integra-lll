import { describe, expect, it } from 'vitest';
import {
  describirDetallePlan,
  describirPlan,
  esPlanPremium,
  FEATURES_PREMIUM,
  incluyeFeature,
  leerPermisos,
  NOMBRES_FEATURES,
  type PermisosPlan,
} from './planes';

describe('reglas y utilidades puras de planes (MX-09, SE-02)', () => {
  it('NOMBRES_FEATURES y FEATURES_PREMIUM definen las funciones requeridas', () => {
    expect(NOMBRES_FEATURES.asistente_financiero).toBe('Asistente financiero');
    expect(NOMBRES_FEATURES.recomendaciones_automaticas).toBe('Recomendaciones automáticas');
    expect(FEATURES_PREMIUM).toEqual(['asistente_financiero', 'recomendaciones_automaticas']);
  });

  describe('leerPermisos', () => {
    it('valida un objeto de permisos Premium correcto', () => {
      const entrada = {
        plan: 'premium',
        features: { asistente_financiero: true, recomendaciones_automaticas: true },
      };
      const resultado = leerPermisos(entrada);
      expect(resultado).toEqual({
        plan: 'premium',
        features: { asistente_financiero: true, recomendaciones_automaticas: true },
      });
    });

    it('valida un objeto de permisos Free correcto', () => {
      const entrada = {
        plan: 'free',
        features: { asistente_financiero: false, recomendaciones_automaticas: false },
      };
      const resultado = leerPermisos(entrada);
      expect(resultado).toEqual({
        plan: 'free',
        features: { asistente_financiero: false, recomendaciones_automaticas: false },
      });
    });

    it('devuelve null ante valores nulos, no objetos o tipos incorrectos', () => {
      expect(leerPermisos(null)).toBeNull();
      expect(leerPermisos(undefined)).toBeNull();
      expect(leerPermisos('premium')).toBeNull();
      expect(leerPermisos(123)).toBeNull();
      expect(leerPermisos([])).toBeNull();
      expect(leerPermisos({})).toBeNull();
    });

    it('devuelve null si el plan es desconocido o inventado', () => {
      expect(leerPermisos({ plan: 'pro', features: {} })).toBeNull();
      expect(leerPermisos({ plan: 'enterprise', features: {} })).toBeNull();
      expect(leerPermisos({ plan: 'super_premium', features: {} })).toBeNull();
    });

    it('convierte a booleano estricto evitando falsos positivos por truthy values', () => {
      const entrada = {
        plan: 'free',
        features: { asistente_financiero: 'true', recomendaciones_automaticas: 1 },
      };
      const resultado = leerPermisos(entrada);
      expect(resultado).toEqual({
        plan: 'free',
        features: { asistente_financiero: false, recomendaciones_automaticas: false },
      });
    });
  });

  describe('incluyeFeature', () => {
    const permisosPremium: PermisosPlan = {
      plan: 'premium',
      features: { asistente_financiero: true, recomendaciones_automaticas: true },
    };
    const permisosFree: PermisosPlan = {
      plan: 'free',
      features: { asistente_financiero: false, recomendaciones_automaticas: false },
    };

    it('retorna true solo si la feature es booleano true explícito', () => {
      expect(incluyeFeature(permisosPremium, 'asistente_financiero')).toBe(true);
      expect(incluyeFeature(permisosPremium, 'recomendaciones_automaticas')).toBe(true);
    });

    it('retorna false si la feature es false', () => {
      expect(incluyeFeature(permisosFree, 'asistente_financiero')).toBe(false);
      expect(incluyeFeature(permisosFree, 'recomendaciones_automaticas')).toBe(false);
    });

    it('retorna false ante permisos null o undefined sin lanzar excepción', () => {
      expect(incluyeFeature(null, 'asistente_financiero')).toBe(false);
      expect(incluyeFeature(undefined, 'recomendaciones_automaticas')).toBe(false);
    });
  });

  describe('esPlanPremium, describirPlan y describirDetallePlan', () => {
    it('esPlanPremium evalúa correctamente', () => {
      expect(esPlanPremium('premium')).toBe(true);
      expect(esPlanPremium('free')).toBe(false);
      expect(esPlanPremium('gratuito')).toBe(false);
      expect(esPlanPremium(null)).toBe(false);
      expect(esPlanPremium(undefined)).toBe(false);
    });

    it('describirPlan entrega el nombre adecuado', () => {
      expect(describirPlan('premium')).toBe('Plan Premium');
      expect(describirPlan('free')).toBe('Plan Gratuito');
      expect(describirPlan(null)).toBe('Plan Gratuito');
      expect(describirPlan(undefined)).toBe('Plan Gratuito');
    });

    it('describirDetallePlan entrega el detalle adecuado', () => {
      expect(describirDetallePlan('premium')).toBe('Asistente financiero y recomendaciones avanzadas.');
      expect(describirDetallePlan('free')).toBe('Alertas de cobro y de prueba gratis incluidas.');
    });
  });
});

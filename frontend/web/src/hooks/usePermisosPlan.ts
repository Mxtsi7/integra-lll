import {
  describirDetallePlan,
  describirPlan,
  esPlanPremium,
  getPermisosPlan,
  incluyeFeature,
  leerPermisos,
  type CodigoPlan,
  type FeaturesPlan,
  type PermisosPlan,
} from '@ojoalgasto/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const MENSAJE_ERROR_PLAN = 'No pudimos comprobar tu plan. Intenta de nuevo.';

export type EstadoPermisos =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; permisos: PermisosPlan };

export interface PoliticaPermisosPlan {
  estado: EstadoPermisos;
  cargando: boolean;
  error: string | null;
  reintentar: () => void;
  tieneFeature: (feature: keyof FeaturesPlan) => boolean;
  esPremium: boolean;
  plan: CodigoPlan | null;
  nombrePlan: string;
  detallePlan: string;
}

/**
 * Política unificada de planes y restricciones (SE-02, S3-CH-16).
 * Lee el plan y lo que incluye según el servidor (GET /api/usuarios/me/permisos/).
 *
 * Mientras no llega, o si falla, no se concede nada por defecto (seguro por omisión).
 * El plan del servidor es el único que cuenta; claims antiguos o HTML no otorgan permisos.
 * Una respuesta de otra sesión se descarta.
 */
export function usePermisosPlan(): PoliticaPermisosPlan {
  const { capturarSesion } = useAuth();
  const capturarSesionRef = useRef(capturarSesion);
  capturarSesionRef.current = capturarSesion;

  // La sesión con la que se montó la página. Si cambia, lo que llegue después es de otra sesión.
  const [sesion] = useState(() => capturarSesion());
  const [intento, setIntento] = useState(0);
  const [estado, setEstado] = useState<EstadoPermisos>({ tipo: 'cargando' });

  useEffect(() => {
    let vigente = true;
    const sigueVigente = () => vigente && capturarSesionRef.current() === sesion;
    setEstado({ tipo: 'cargando' });
    getPermisosPlan()
      .then((respuesta) => {
        if (!sigueVigente()) return;
        const permisos = leerPermisos(respuesta);
        if (permisos) {
          setEstado({ tipo: 'listo', permisos });
        } else {
          setEstado({ tipo: 'error', mensaje: MENSAJE_ERROR_PLAN });
        }
      })
      .catch(() => {
        if (sigueVigente()) setEstado({ tipo: 'error', mensaje: MENSAJE_ERROR_PLAN });
      });
    return () => {
      vigente = false;
    };
  }, [intento, sesion]);

  const reintentar = useCallback(() => setIntento((anterior) => anterior + 1), []);

  const tieneFeature = useCallback(
    (feature: keyof FeaturesPlan) => {
      if (estado.tipo !== 'listo') return false;
      return incluyeFeature(estado.permisos, feature);
    },
    [estado],
  );

  const esPremium = estado.tipo === 'listo' && esPlanPremium(estado.permisos.plan);
  const plan = estado.tipo === 'listo' ? estado.permisos.plan : null;
  const nombrePlan = describirPlan(plan);
  const detallePlan = describirDetallePlan(plan);

  const cargando = estado.tipo === 'cargando';
  const error = estado.tipo === 'error' ? estado.mensaje : null;

  return {
    estado,
    cargando,
    error,
    reintentar,
    tieneFeature,
    esPremium,
    plan,
    nombrePlan,
    detallePlan,
  };
}

import { getPermisosPlan, type PermisosPlan } from '@ojoalgasto/shared';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const MENSAJE_ERROR_PLAN = 'No pudimos comprobar tu plan. Intenta de nuevo.';

export type EstadoPermisos =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; permisos: PermisosPlan };

/**
 * S3-CH-16: el plan y lo que incluye, según el servidor (GET /api/usuarios/me/permisos/).
 *
 * Mientras no llega, o si falla, no se concede nada por defecto: el plan que dice el
 * servidor es el único que cuenta. Una respuesta de otra sesión se descarta.
 */
export function usePermisosPlan(): { estado: EstadoPermisos; reintentar: () => void } {
  const { capturarSesion } = useAuth();
  // La sesión con la que se montó la página. Si cambia, lo que llegue después es de otra sesión.
  const [sesion] = useState(capturarSesion);
  const [intento, setIntento] = useState(0);
  const [estado, setEstado] = useState<EstadoPermisos>({ tipo: 'cargando' });

  useEffect(() => {
    let vigente = true;
    const sigueVigente = () => vigente && capturarSesion() === sesion;
    setEstado({ tipo: 'cargando' });
    getPermisosPlan()
      .then((permisos) => {
        if (sigueVigente()) setEstado({ tipo: 'listo', permisos });
      })
      .catch(() => {
        if (sigueVigente()) setEstado({ tipo: 'error', mensaje: MENSAJE_ERROR_PLAN });
      });
    return () => {
      vigente = false;
    };
  }, [intento, capturarSesion, sesion]);

  const reintentar = useCallback(() => setIntento((anterior) => anterior + 1), []);
  return { estado, reintentar };
}

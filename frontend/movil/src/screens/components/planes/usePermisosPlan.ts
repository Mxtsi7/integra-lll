import { useCallback, useEffect, useRef, useState } from 'react';
import { getPermisosPlan, type EstadoCarga, type FeaturesPlan, type PermisosPlan } from '@ojoalgasto/shared';
import { incluyeFeature, leerPermisos } from './reglasPlanes';

/** La llamada al backend. Se reemplaza en las pruebas por una función falsa. */
export interface ApiPermisos {
  getPermisosPlan: typeof getPermisosPlan;
}

const API_REAL: ApiPermisos = { getPermisosPlan };

/**
 * Lee del servidor qué incluye el plan de la persona (AN-11). El plan del token o de la
 * pantalla anterior no se usa: lo que manda es la respuesta de `/usuarios/me/permisos/`.
 * Mientras carga, si falla o si la respuesta es rara, no hay permisos: todo lo Premium queda bloqueado.
 *
 * La pantalla puede seguir montada mientras la persona contrata o cancela el plan en otra
 * (Restricciones → Planes → volver). Por eso, cada vez que se vuelve a la pantalla
 * (`alVolverAPantalla`) se consulta de nuevo: queda bloqueado mientras se confirma, y la respuesta
 * anterior, si llega tarde, se descarta.
 */
export function usePermisosPlan(api: ApiPermisos = API_REAL, alVolverAPantalla?: (alVolver: () => void) => () => void) {
  const [estado, setEstado] = useState<EstadoCarga<PermisosPlan>>({ tipo: 'cargando' });
  const numeroDeCarga = useRef(0);

  const cargar = useCallback(async () => {
    numeroDeCarga.current += 1;
    const miCarga = numeroDeCarga.current;
    setEstado({ tipo: 'cargando' });
    try {
      const permisos = leerPermisos(await api.getPermisosPlan());
      if (miCarga !== numeroDeCarga.current) return; // llegó tarde: se recargó o se salió de la pantalla
      setEstado(permisos ? { tipo: 'listo', datos: permisos } : { tipo: 'error' });
    } catch {
      if (miCarga !== numeroDeCarga.current) return;
      setEstado({ tipo: 'error' });
    }
  }, [api]);

  useEffect(() => {
    void cargar();
    return () => {
      numeroDeCarga.current += 1;
    };
  }, [cargar]);

  // La última versión de `cargar` sin volver a suscribirse en cada render.
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  useEffect(() => alVolverAPantalla?.(() => void cargarRef.current()), [alVolverAPantalla]);

  return { estado, cargar };
}

/** ¿Está permitida esta función? Cargando, error o desconocido = no. */
export function estaPermitida(estado: EstadoCarga<PermisosPlan>, feature: keyof FeaturesPlan): boolean {
  return estado.tipo === 'listo' && incluyeFeature(estado.datos, feature);
}

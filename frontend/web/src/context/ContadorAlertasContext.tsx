import { getContadorAlertas } from '@ojoalgasto/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface EstadoContadorAlertas {
  /** Alertas sin leer de toda la organización (FE-20). null mientras no se sabe. */
  pendientes: number | null;
  /** Vuelve a preguntar al servidor. */
  actualizar: () => void;
  /**
   * Una lectura que el servidor ya confirmó: la campana baja al instante y
   * después se confirma con el servidor, que es quien tiene el número real.
   */
  descontar: (cuantas: number) => void;
}

// Fuera del provider (pruebas de una página suelta) la campana va sin número.
const ContadorAlertasContext = createContext<EstadoContadorAlertas>({
  pendientes: null,
  actualizar: () => {},
  descontar: () => {},
});

/**
 * El número de la campana (CH-31). Es uno solo para todas las páginas: la
 * barra superior lo muestra y el Centro de alertas lo cambia al leer.
 *
 * Se monta dentro de <RutaPrivada>, que lo vuelve a montar si cambia la
 * sesión: el número de una cuenta no queda en la campana de la otra.
 */
export function ContadorAlertasProvider({ children }: { children: ReactNode }) {
  const [pendientes, setPendientes] = useState<number | null>(null);
  // Solo vale la última respuesta pedida. Una que salió antes de una lectura
  // traería el número de antes y volvería a subir la campana.
  const peticion = useRef(0);

  const actualizar = useCallback(() => {
    const id = ++peticion.current;
    getContadorAlertas()
      .then((contador) => {
        if (peticion.current === id) setPendientes(contador.pendientes);
      })
      .catch(() => {
        // Sin servidor se queda lo último que se supo: una campana vacía
        // diría «no tienes alertas», que no es lo que pasó.
      });
  }, []);

  const descontar = useCallback(
    (cuantas: number) => {
      setPendientes((actual) => (actual === null ? null : Math.max(0, actual - cuantas)));
      actualizar();
    },
    [actualizar],
  );

  useEffect(() => {
    actualizar();
    // Las alertas nacen en el servidor: al volver a la pestaña se pregunta de nuevo.
    const alVolver = () => {
      if (document.visibilityState === 'visible') actualizar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      peticion.current += 1;
    };
  }, [actualizar]);

  const valor = useMemo(() => ({ pendientes, actualizar, descontar }), [pendientes, actualizar, descontar]);
  return <ContadorAlertasContext.Provider value={valor}>{children}</ContadorAlertasContext.Provider>;
}

export function useContadorAlertas() {
  return useContext(ContadorAlertasContext);
}

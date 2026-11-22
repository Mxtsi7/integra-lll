import { getResumenDelPeriodo, type ResumenDelPeriodo } from '@ojoalgasto/shared';
import { useCallback, useEffect, useState } from 'react';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

const MENSAJE_ERROR = 'No pudimos cargar el resumen de este periodo. Intenta de nuevo.';

export type EstadoResumen =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; resumen: ResumenDelPeriodo };

/**
 * El resumen de un mes "YYYY-MM" (VI-06). Lo usa la página de Informes.
 *
 * Al cambiar de mes nunca quedan a la vista las cifras del mes anterior: el resultado se guarda
 * junto con el mes al que pertenece, y si no es el pedido ahora se trata como "cargando". Una
 * respuesta que llega tarde (de un mes que ya se dejó) se descarta.
 *
 * `cargar` tiene que ser una función estable (la de shared, no una flecha nueva en cada render):
 * si cambia, el resumen se vuelve a pedir.
 */
export function useResumenPeriodo(
  mes: string,
  cargar: (mes: string) => Promise<ResumenDelPeriodo> = getResumenDelPeriodo,
): { estado: EstadoResumen; reintentar: () => void } {
  const [resultado, setResultado] = useState<{ mes: string; estado: EstadoResumen } | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setResultado({ mes, estado: { tipo: 'cargando' } });
    cargar(mes)
      .then((resumen) => {
        if (vigente) setResultado({ mes, estado: { tipo: 'listo', resumen } });
      })
      .catch((err: unknown) => {
        if (!vigente) return;
        const mensaje = err instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR;
        setResultado({ mes, estado: { tipo: 'error', mensaje } });
      });
    return () => {
      vigente = false;
    };
  }, [mes, cargar, intento]);

  const reintentar = useCallback(() => setIntento((anterior) => anterior + 1), []);
  const estado: EstadoResumen = resultado?.mes === mes ? resultado.estado : { tipo: 'cargando' };
  return { estado, reintentar };
}

import { getCobrosDelMes, type CobroCalendario } from '@ojoalgasto/shared';
import { useCallback, useEffect, useState } from 'react';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

const MENSAJE_ERROR = 'No pudimos cargar tus cobros. Intenta de nuevo.';

export type EstadoCobros =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; cobros: CobroCalendario[] };

/**
 * Cobros de un mes "YYYY-MM" desde VI-07. Lo usan el Calendario y la Agenda
 * (CH-18 a CH-21), así ambos muestran exactamente los mismos cobros.
 *
 * Al cambiar de mes nunca quedan a la vista los cobros del mes anterior:
 * el resultado se guarda junto con el mes al que pertenece, y si no es el
 * pedido ahora se trata como "cargando". Una respuesta que llega tarde (de
 * un mes que ya se dejó) se descarta.
 */
export function useCobrosDelMes(mes: string): { estado: EstadoCobros; reintentar: () => void } {
  const [resultado, setResultado] = useState<{ mes: string; estado: EstadoCobros } | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setResultado({ mes, estado: { tipo: 'cargando' } });
    getCobrosDelMes(mes)
      .then((cobros) => {
        if (vigente) setResultado({ mes, estado: { tipo: 'listo', cobros } });
      })
      .catch((err: unknown) => {
        if (!vigente) return;
        const mensaje = err instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR;
        setResultado({ mes, estado: { tipo: 'error', mensaje } });
      });
    return () => {
      vigente = false;
    };
  }, [mes, intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);
  const estado: EstadoCobros = resultado?.mes === mes ? resultado.estado : { tipo: 'cargando' };
  return { estado, reintentar };
}

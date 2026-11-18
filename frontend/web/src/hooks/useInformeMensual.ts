import { getResumenDelMes, type ResumenDelMes } from '@ojoalgasto/shared';
import { useCallback, useEffect, useState } from 'react';
import { mesesDelInforme } from '../components/informes/periodosDeInforme';
import { useAuth } from '../context/AuthContext';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

export const MENSAJE_ERROR_INFORME = 'No pudimos cargar tus gastos. Intenta de nuevo.';

export type CargaInforme =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  /** Un resumen por mes, del más antiguo al elegido, que es el último. */
  | { tipo: 'listo'; meses: readonly ResumenDelMes[] };

/**
 * S3-CH-25: el gasto de un mes y de los anteriores en una moneda (VI-06), para las cifras y
 * el gráfico del informe. Se piden juntos y se muestran juntos o no se muestra nada: así las
 * cifras del mes elegido y el gráfico nunca salen de respuestas distintas.
 *
 * - Al cambiar de mes o de moneda nunca queda a la vista lo del anterior: el resultado se
 *   guarda junto a lo que se pidió, y si no es lo pedido ahora se trata como "cargando".
 * - Una respuesta tardía de lo que ya se dejó, o de otra sesión, se descarta.
 */
export function useInformeMensual(mes: string, moneda: string): { carga: CargaInforme; reintentar: () => void } {
  const { capturarSesion } = useAuth();
  // La sesión con la que se montó la página. Si cambia, lo que llegue después es de otra sesión.
  const [sesion] = useState(capturarSesion);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<{ pedido: string; carga: CargaInforme } | null>(null);
  const pedido = JSON.stringify([mes, moneda]);

  useEffect(() => {
    let vigente = true;
    const sigueVigente = () => vigente && capturarSesion() === sesion;
    setResultado({ pedido, carga: { tipo: 'cargando' } });
    Promise.all(mesesDelInforme(mes).map((unMes) => getResumenDelMes(unMes, moneda)))
      .then((meses) => {
        if (sigueVigente()) setResultado({ pedido, carga: { tipo: 'listo', meses } });
      })
      .catch((error: unknown) => {
        if (!sigueVigente()) return;
        const mensaje = error instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR_INFORME;
        setResultado({ pedido, carga: { tipo: 'error', mensaje } });
      });
    return () => {
      vigente = false;
    };
  }, [mes, moneda, pedido, intento, capturarSesion, sesion]);

  const reintentar = useCallback(() => setIntento((anterior) => anterior + 1), []);
  const carga: CargaInforme = resultado?.pedido === pedido ? resultado.carga : { tipo: 'cargando' };
  return { carga, reintentar };
}

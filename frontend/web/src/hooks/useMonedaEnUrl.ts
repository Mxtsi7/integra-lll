import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * La moneda que se mira en Informes vive en la URL (?moneda=CLP), junto al mes: al recargar
 * se queda en la misma, y Atrás/Adelante del navegador la recorren.
 *
 * Una moneda que no esté entre las disponibles (mal escrita, o que ya no existe) no se pide
 * a la API: se usa la predeterminada, y si tampoco está, la primera. Sin monedas, null.
 */
export function useMonedaEnUrl(
  monedasDisponibles: readonly string[],
  predeterminada: string | null,
): { moneda: string | null; irAMoneda: (moneda: string) => void } {
  const [parametros, setParametros] = useSearchParams();
  const pedida = parametros.get('moneda');

  let moneda: string | null = null;
  if (pedida !== null && monedasDisponibles.includes(pedida)) moneda = pedida;
  else if (predeterminada !== null && monedasDisponibles.includes(predeterminada)) moneda = predeterminada;
  else moneda = monedasDisponibles[0] ?? null;

  const irAMoneda = useCallback(
    (nueva: string) =>
      setParametros((actuales) => {
        const siguientes = new URLSearchParams(actuales);
        siguientes.set('moneda', nueva);
        return siguientes;
      }),
    [setParametros],
  );

  return { moneda, irAMoneda };
}

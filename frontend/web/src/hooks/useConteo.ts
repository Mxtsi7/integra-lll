import { useEffect, useState } from 'react';

function prefiereMenosMovimiento(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Cuenta desde cero hasta `valor` la primera vez que aparece, y después
 * sigue los cambios al tiro. Con "reducir movimiento" activado entrega el
 * valor final de inmediato.
 */
export function useConteo(valor: number, duracionMs = 900): number {
  const [mostrado, setMostrado] = useState(() => (prefiereMenosMovimiento() ? valor : 0));

  useEffect(() => {
    if (prefiereMenosMovimiento() || typeof requestAnimationFrame !== 'function') {
      setMostrado(valor);
      return;
    }
    let cuadro = 0;
    const desde = mostrado;
    const inicio = performance.now();
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracionMs);
      // Sale rápido y frena al final, como un contador que se asienta.
      const suavizado = 1 - Math.pow(1 - t, 3);
      setMostrado(desde + (valor - desde) * suavizado);
      if (t < 1) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(cuadro);
    // Solo reacciona al valor: `mostrado` es el punto de partida, no un disparador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, duracionMs]);

  return mostrado;
}

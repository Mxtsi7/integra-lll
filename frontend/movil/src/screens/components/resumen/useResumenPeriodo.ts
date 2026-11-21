import { useCallback, useEffect, useRef, useState } from 'react';
import { getResumenDelPeriodo, type EstadoCarga, type ResumenDelPeriodo } from '@ojoalgasto/shared';

/** La llamada al backend. Se reemplaza en las pruebas por una función falsa. */
export interface ApiResumen {
  getResumenDelPeriodo: typeof getResumenDelPeriodo;
}

const API_REAL: ApiResumen = { getResumenDelPeriodo };

/**
 * El resumen de un mes ("YYYY-MM"). Cada vez que cambia el mes se vuelve a pedir.
 *
 * - Si la persona cambia de mes rápido, la respuesta del mes anterior llega tarde y se descarta:
 *   `numeroDeCarga` sube en cada carga y cada respuesta compara el suyo con el actual.
 * - Al cambiar de mes se muestra "cargando", nunca las cifras del mes anterior bajo el título nuevo.
 * - `enSegundoPlano` (al volver a la pantalla) refresca sin vaciar lo que ya se ve; si falla, deja
 *   las cifras que había, salvo que no hubiera nada (entonces muestra el error con reintento).
 */
export function useResumenPeriodo(mes: string, api: ApiResumen = API_REAL) {
  // El resultado se guarda junto con el mes al que pertenece: si no es el mes pedido ahora, se trata como
  // "cargando". Así, en el primer render tras cambiar de mes nunca se ven las cifras del mes anterior.
  const [resultado, setResultado] = useState<{ mes: string; estado: EstadoCarga<ResumenDelPeriodo> } | null>(null);
  const numeroDeCarga = useRef(0);
  const estado: EstadoCarga<ResumenDelPeriodo> = resultado?.mes === mes ? resultado.estado : { tipo: 'cargando' };

  const cargar = useCallback(
    async (opciones: { enSegundoPlano?: boolean } = {}) => {
      const { enSegundoPlano = false } = opciones;
      numeroDeCarga.current += 1;
      const miCarga = numeroDeCarga.current;
      if (!enSegundoPlano) setResultado({ mes, estado: { tipo: 'cargando' } });

      try {
        const resumen = await api.getResumenDelPeriodo(mes);
        if (miCarga !== numeroDeCarga.current) return;
        setResultado({ mes, estado: { tipo: 'listo', datos: resumen } });
      } catch {
        if (miCarga !== numeroDeCarga.current) return;
        setResultado((actual) =>
          enSegundoPlano && actual?.mes === mes && actual.estado.tipo === 'listo' ? actual : { mes, estado: { tipo: 'error' } },
        );
      }
    },
    [api, mes],
  );

  useEffect(() => {
    void cargar();
    return () => {
      numeroDeCarga.current += 1; // al cambiar de mes o salir, las respuestas pendientes se ignoran
    };
  }, [cargar]);

  return { estado, cargar };
}

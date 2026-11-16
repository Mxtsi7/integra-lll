import { useCallback, useEffect, useRef, useState } from 'react';
import { getCobrosDelMes, type CobroCalendario, type EstadoCarga } from '@ojoalgasto/shared';

/** La llamada al backend. Se reemplaza en las pruebas por una función falsa. */
export interface ApiCalendario {
  getCobrosDelMes: typeof getCobrosDelMes;
}

const API_REAL: ApiCalendario = { getCobrosDelMes };

/**
 * Cobros de un mes ("YYYY-MM"). Cada vez que cambia el mes se vuelve a cargar.
 * Si la persona cambia de mes rápido, la respuesta del mes anterior llega tarde y se descarta:
 * `numeroDeCarga` sube en cada carga y cada respuesta compara el suyo con el actual.
 */
export function useCobrosDelMes(mes: string, api: ApiCalendario = API_REAL) {
  const [estado, setEstado] = useState<EstadoCarga<CobroCalendario[]>>({ tipo: 'cargando' });
  const numeroDeCarga = useRef(0);

  const cargar = useCallback(async () => {
    numeroDeCarga.current += 1;
    const miCarga = numeroDeCarga.current;
    setEstado({ tipo: 'cargando' });

    try {
      const cobros = await api.getCobrosDelMes(mes);
      if (miCarga !== numeroDeCarga.current) return;
      setEstado({ tipo: 'listo', datos: cobros });
    } catch {
      if (miCarga !== numeroDeCarga.current) return;
      setEstado({ tipo: 'error' });
    }
  }, [api, mes]);

  useEffect(() => {
    void cargar();
    return () => {
      numeroDeCarga.current += 1;
    };
  }, [cargar]);

  return { estado, cargar };
}

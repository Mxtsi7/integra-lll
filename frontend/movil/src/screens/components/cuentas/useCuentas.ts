import { useCallback, useEffect, useRef, useState } from 'react';
import { desconectarCuenta, getCuentasConectadas, type CuentaConectada, type EstadoCarga } from '@ojoalgasto/shared';

/** Las llamadas al backend. Se reemplazan en las pruebas por funciones falsas. */
export interface ApiCuentas {
  getCuentasConectadas: typeof getCuentasConectadas;
  desconectarCuenta: typeof desconectarCuenta;
}

const API_REAL: ApiCuentas = { getCuentasConectadas, desconectarCuenta };

export const MENSAJE_ERROR_DESCONEXION = 'No pudimos desconectar la cuenta. Inténtalo de nuevo.';

/**
 * Carga la lista de cuentas conectadas y permite desconectarlas (AN-06).
 * Si llega una respuesta vieja (se recargó o se salió de la pantalla), se descarta:
 * `numeroDeCarga` sube en cada carga y cada respuesta compara el suyo con el actual.
 */
export function useCuentas(api: ApiCuentas = API_REAL) {
  const [estado, setEstado] = useState<EstadoCarga<CuentaConectada[]>>({ tipo: 'cargando' });
  const [idsDesconectando, setIdsDesconectando] = useState<string[]>([]);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const numeroDeCarga = useRef(0);
  const idsEnCurso = useRef(new Set<string>()); // candado contra doble toque

  const cargar = useCallback(async () => {
    numeroDeCarga.current += 1;
    const miCarga = numeroDeCarga.current;
    setEstado({ tipo: 'cargando' });
    setMensajeError(null);

    try {
      const cuentas = await api.getCuentasConectadas();
      if (miCarga !== numeroDeCarga.current) return;
      setEstado({ tipo: 'listo', datos: cuentas });
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

  const desconectar = useCallback(
    async (id: string) => {
      if (idsEnCurso.current.has(id)) return;
      idsEnCurso.current.add(id);
      setIdsDesconectando((ids) => [...ids, id]);
      setMensajeError(null);
      const miCarga = numeroDeCarga.current;

      try {
        // El backend devuelve la cuenta ya desconectada: se usa tal cual, sin adivinar el estado.
        const cuentaActualizada = await api.desconectarCuenta(id);
        if (miCarga !== numeroDeCarga.current) return;
        setEstado((actual) =>
          actual.tipo !== 'listo'
            ? actual
            : { tipo: 'listo', datos: actual.datos.map((cuenta) => (cuenta.id === id ? cuentaActualizada : cuenta)) },
        );
      } catch {
        if (miCarga !== numeroDeCarga.current) return;
        setMensajeError(MENSAJE_ERROR_DESCONEXION);
      } finally {
        idsEnCurso.current.delete(id);
        if (miCarga === numeroDeCarga.current) setIdsDesconectando((ids) => ids.filter((otroId) => otroId !== id));
      }
    },
    [api],
  );

  return { estado, idsDesconectando, mensajeError, cargar, desconectar };
}

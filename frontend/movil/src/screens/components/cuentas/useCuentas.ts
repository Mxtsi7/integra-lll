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
 *
 * Hay dos cosas distintas que coordinar:
 * - Las CONSULTAS de la lista: si llega una respuesta vieja se descarta (`numeroDeCarga`).
 * - Las DESCONEXIONES: su resultado es válido aunque mientras tanto se haya recargado la lista,
 *   así que NO se comparan con `numeroDeCarga`. Solo se descartan si la pantalla ya se cerró.
 *
 * Cuando una desconexión termina (bien o mal) se vuelve a pedir la lista: una consulta que salió
 * antes de que el backend procesara el DELETE puede traer la cuenta todavía conectada, y la
 * recarga final deja en pantalla lo que el backend confirma.
 */
export function useCuentas(api: ApiCuentas = API_REAL) {
  const [estado, setEstado] = useState<EstadoCarga<CuentaConectada[]>>({ tipo: 'cargando' });
  const [idsDesconectando, setIdsDesconectando] = useState<string[]>([]);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const numeroDeCarga = useRef(0);
  const sigueMontado = useRef(true);
  const idsEnCurso = useRef(new Set<string>()); // candado contra doble toque

  /**
   * `enSegundoPlano`: no vacía la pantalla ni la reemplaza por un error si falla;
   * se usa para reconciliar después de una desconexión.
   */
  const cargar = useCallback(
    async (opciones: { enSegundoPlano?: boolean } = {}) => {
      const { enSegundoPlano = false } = opciones;
      numeroDeCarga.current += 1;
      const miCarga = numeroDeCarga.current;
      if (!enSegundoPlano) {
        setEstado({ tipo: 'cargando' });
        setMensajeError(null);
      }

      try {
        const cuentas = await api.getCuentasConectadas();
        if (miCarga !== numeroDeCarga.current) return;
        setEstado({ tipo: 'listo', datos: cuentas });
      } catch {
        if (miCarga !== numeroDeCarga.current) return;
        if (enSegundoPlano) {
          setEstado((actual) => (actual.tipo === 'cargando' ? { tipo: 'error' } : actual));
          return;
        }
        setEstado({ tipo: 'error' });
      }
    },
    [api],
  );

  useEffect(() => {
    sigueMontado.current = true;
    void cargar();
    return () => {
      sigueMontado.current = false;
      numeroDeCarga.current += 1; // al salir de la pantalla, las respuestas pendientes se ignoran
    };
  }, [cargar]);

  const desconectar = useCallback(
    async (id: string) => {
      if (idsEnCurso.current.has(id)) return;
      idsEnCurso.current.add(id);
      setIdsDesconectando((ids) => [...ids, id]);
      setMensajeError(null);

      try {
        // El backend devuelve la cuenta ya desconectada: se usa tal cual, sin adivinar el estado.
        const cuentaActualizada = await api.desconectarCuenta(id);
        if (sigueMontado.current) {
          setEstado((actual) =>
            actual.tipo !== 'listo'
              ? actual
              : { tipo: 'listo', datos: actual.datos.map((cuenta) => (cuenta.id === id ? cuentaActualizada : cuenta)) },
          );
        }
      } catch {
        if (sigueMontado.current) setMensajeError(MENSAJE_ERROR_DESCONEXION);
      } finally {
        idsEnCurso.current.delete(id);
        if (sigueMontado.current) {
          setIdsDesconectando((ids) => ids.filter((otroId) => otroId !== id));
          // Un timeout no prueba que el backend no procesó el DELETE: también se reconcilia al fallar.
          void cargar({ enSegundoPlano: true });
        }
      }
    },
    [api, cargar],
  );

  return { estado, idsDesconectando, mensajeError, cargar, desconectar };
}

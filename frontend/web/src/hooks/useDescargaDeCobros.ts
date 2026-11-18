import { exportarCobrosCsv, type ConsultaExportacionCobros } from '@ojoalgasto/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { guardarArchivo } from '../utils/descargas';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

export const MENSAJE_ERROR_DESCARGA = 'No pudimos descargar los cobros. Intenta de nuevo.';
const TIPO_CSV = 'text/csv;charset=utf-8';

export type ResultadoDeDescarga =
  | { tipo: 'lista'; nombre: string }
  | { tipo: 'error'; mensaje: string };

/**
 * S3-CH-25: baja el CSV de cobros del rango y la moneda (VI-25) y lo entrega como archivo.
 *
 * - Una descarga a la vez: un segundo clic mientras corre no pide otro archivo.
 * - El resultado se muestra solo mientras la selección (rango y moneda) sea la misma que la
 *   pedida: el aviso de lo descargado nunca se queda al lado de otro mes u otra moneda.
 * - Si la sesión cambió mientras se descargaba, no se entrega el archivo: era de otra sesión.
 *
 * `nombreDelArchivo` lo decide quien llama, porque es lo que ve la persona en su descarga.
 */
export function useDescargaDeCobros(
  consulta: ConsultaExportacionCobros,
  nombreDelArchivo: string,
): { enCurso: boolean; resultado: ResultadoDeDescarga | null; descargar: () => Promise<void> } {
  const { capturarSesion } = useAuth();
  const [sesion] = useState(capturarSesion);
  const montado = useRef(false);
  const hayDescargaEnCurso = useRef(false);

  const [enCurso, setEnCurso] = useState(false);
  const [guardado, setGuardado] = useState<{ pedido: string; resultado: ResultadoDeDescarga } | null>(null);

  const { desde, hasta, moneda } = consulta;
  const pedido = JSON.stringify([desde, hasta, moneda]);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const descargar = useCallback(async () => {
    const sigueVigente = () => montado.current && capturarSesion() === sesion;
    if (hayDescargaEnCurso.current || !sigueVigente()) return;
    hayDescargaEnCurso.current = true;
    setEnCurso(true);
    setGuardado(null);
    try {
      const contenido = await exportarCobrosCsv({ desde, hasta, moneda });
      if (!sigueVigente()) return;
      guardarArchivo(nombreDelArchivo, contenido, TIPO_CSV);
      setGuardado({ pedido, resultado: { tipo: 'lista', nombre: nombreDelArchivo } });
    } catch (error: unknown) {
      if (!sigueVigente()) return;
      const mensaje = error instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR_DESCARGA;
      setGuardado({ pedido, resultado: { tipo: 'error', mensaje } });
    } finally {
      hayDescargaEnCurso.current = false;
      if (montado.current) setEnCurso(false);
    }
  }, [desde, hasta, moneda, nombreDelArchivo, pedido, capturarSesion, sesion]);

  const resultado = guardado?.pedido === pedido ? guardado.resultado : null;
  return { enCurso, resultado, descargar };
}

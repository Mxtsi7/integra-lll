// S3-AN-06 · Historial de accesos (GET /usuarios/me/historial-accesos/, servicio auth).
import { ErrorDeApi, pedir } from './cliente';

/** Cómo se inició la sesión: contraseña o Google. */
export type MetodoAcceso = 'local' | 'google';

export interface AccesoRegistrado {
  /** Fecha y hora del inicio de sesión, ISO 8601. */
  iniciadaEn: string;
  metodo: MetodoAcceso;
}

export interface PaginaAccesos {
  /** Del más reciente al más antiguo. */
  accesos: AccesoRegistrado[];
  /** Desde dónde pedir la página siguiente; null si no hay más. */
  siguienteOffset: number | null;
}

/** Cuántos accesos se piden por página (el backend admite hasta 100). */
export const LIMITE_ACCESOS = 20;

interface CuerpoHistorial {
  resultados?: unknown;
  siguiente_offset?: unknown;
}

function esAcceso(valor: unknown): valor is { iniciada_en: string; metodo: MetodoAcceso } {
  if (typeof valor !== 'object' || valor === null) return false;
  const a = valor as Record<string, unknown>;
  return typeof a.iniciada_en === 'string' && (a.metodo === 'local' || a.metodo === 'google');
}

/**
 * Una página del historial. Errores (ErrorDeApi, por status): 400 paginación inválida ·
 * 401 sesión vencida · 403 contexto inválido · 404 usuario inexistente. Una respuesta con otra
 * forma se trata como error: no se muestra como "sin accesos".
 */
export async function obtenerHistorialAccesos(
  opciones: { offset?: number; limite?: number; signal?: AbortSignal } = {},
): Promise<PaginaAccesos> {
  const { offset = 0, limite = LIMITE_ACCESOS, signal } = opciones;
  const cuerpo = await pedir<CuerpoHistorial>(
    `/usuarios/me/historial-accesos/?limit=${limite}&offset=${offset}`,
    { signal },
  );
  const siguiente = cuerpo?.siguiente_offset;
  if (
    !cuerpo ||
    !Array.isArray(cuerpo.resultados) ||
    !cuerpo.resultados.every(esAcceso) ||
    !(siguiente === null || (typeof siguiente === 'number' && Number.isInteger(siguiente) && siguiente >= 0))
  ) {
    throw new ErrorDeApi('El servicio respondió en un formato inesperado.', 502);
  }
  return {
    accesos: cuerpo.resultados.map((a) => ({ iniciadaEn: a.iniciada_en, metodo: a.metodo })),
    siguienteOffset: siguiente,
  };
}

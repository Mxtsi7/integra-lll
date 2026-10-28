import type { CobroCalendario } from '../tipos';
import { pedir } from './cliente';

// VI-07: cobros confirmados y proyectados de un mes de la organización.
const RUTA_CALENDARIO = '/suscripciones/calendario-cobros/';

/** "YYYY-MM" con mes 01-12: el mismo formato que exige el backend. */
const FORMATO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Lo que manda la API: el importe es un DecimalField y llega como texto. */
type CobroCalendarioDeApi = Omit<CobroCalendario, 'importe'> & { importe: string };

/** ¿Es un mes "YYYY-MM" que el backend acepta? */
export function esMesValido(mes: string): boolean {
  return FORMATO_MES.test(mes);
}

/**
 * GET /api/suscripciones/calendario-cobros/?mes=YYYY-MM (VI-07, para CH-18 a
 * CH-21). Devuelve los cobros ya ordenados por fecha y servicio. Incluye los
 * confirmados del mes y las proyecciones de hoy en adelante; si una
 * suscripción ya tiene un cobro confirmado ese mes, no se proyecta de nuevo.
 *
 * Un mes mal escrito no se manda: el backend lo rechazaría con 400.
 */
export async function getCobrosDelMes(mes: string): Promise<CobroCalendario[]> {
  if (!esMesValido(mes)) throw new RangeError(`Mes inválido: "${mes}". Debe ser YYYY-MM.`);
  const cobros = await pedir<CobroCalendarioDeApi[]>(`${RUTA_CALENDARIO}?mes=${mes}`);
  return cobros.map((c) => ({ ...c, importe: Number(c.importe) }));
}

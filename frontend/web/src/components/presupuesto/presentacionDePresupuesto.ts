import { conMayuscula, formatearAhorro, formatearMesAnio, type ComparacionDePresupuesto } from '@ojoalgasto/shared';
import { partesDeMes } from '../../utils/calendario';

/** "2026-11" → "noviembre de 2026". */
export function nombreDelMes(mes: string): string {
  const { anio, mes: indice } = partesDeMes(mes);
  return formatearMesAnio(anio, indice);
}

/** "2026-11" → "Noviembre de 2026", para títulos. */
export function tituloDelMes(mes: string): string {
  return conMayuscula(nombreDelMes(mes));
}

/**
 * Un monto del servidor (texto decimal) listo para mostrar: ("200000.00", "CLP") → "$200.000".
 * Si no se le puede dar formato se muestra tal cual y con su moneda, en vez de inventar un 0.
 */
export function montoDelServidor(monto: string, moneda: string): string {
  const numero = monto.trim() === '' ? Number.NaN : Number(monto);
  return formatearAhorro(numero, moneda) ?? `${monto} ${moneda}`;
}

/** "-35000.00" → "35000.00". Para decir cuánto se pasó sin repetir el signo en la frase. */
export function montoSinSigno(monto: string): string {
  return monto.replace(/^[-+]/, '');
}

/** ¿El monto del servidor es un cero de verdad? Un texto vacío o que no es número no cuenta como cero. */
export function esMontoCero(monto: string): boolean {
  return monto.trim() !== '' && Number(monto) === 0;
}

const FORMATO_DEL_PORCENTAJE = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });

/** 82.5 → "82,5 %". Se muestra el porcentaje real del servidor, aunque pase de 100. */
export function porcentajeLegible(porcentaje: number): string {
  return `${FORMATO_DEL_PORCENTAJE.format(porcentaje)} %`;
}

/** Cuánto de la barra se llena (0 a 100): la barra no se sale de su caja, el porcentaje escrito sí dice el exceso. */
export function anchoDeLaBarra(porcentaje: number): number {
  if (!Number.isFinite(porcentaje) || porcentaje <= 0) return 0;
  return Math.min(100, porcentaje);
}

/**
 * Las tres situaciones que el servidor distingue, y que no se deben confundir:
 * - sin presupuesto: el mes no tiene uno definido en esa moneda (`presupuesto` es null);
 * - dentro: hay presupuesto y el total esperado no lo pasa;
 * - superado: hay presupuesto y `alerta_superado` lo marca el servidor.
 * Un gasto de 0 no es una situación aparte: es un gasto de 0 dentro de cualquiera de las tres.
 */
export type SituacionDelPresupuesto = 'sin_presupuesto' | 'dentro_del_presupuesto' | 'presupuesto_superado';

export function situacionDelPresupuesto(comparacion: ComparacionDePresupuesto): SituacionDelPresupuesto {
  if (comparacion.presupuesto === null) return 'sin_presupuesto';
  return comparacion.alerta_superado ? 'presupuesto_superado' : 'dentro_del_presupuesto';
}

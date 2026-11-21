import {
  formatearAhorro,
  formatearMesAnio,
  rangoDelMes,
  type ResumenDelMes,
} from '@ojoalgasto/shared';
import { partesDeMes, sumarMeses } from '../../utils/calendario';

/** Cuántos meses muestra el informe: el elegido y los anteriores. */
export const MESES_DEL_INFORME = 6;

/** Los meses del informe, del más antiguo al elegido: ("2026-10", 3) → ["2026-08", "2026-09", "2026-10"]. */
export function mesesDelInforme(mesElegido: string, cantidad: number = MESES_DEL_INFORME): string[] {
  return Array.from({ length: cantidad }, (_, posicion) => sumarMeses(mesElegido, posicion - (cantidad - 1)));
}

/** "2026-10" → "octubre de 2026". */
export function nombreDelMes(mes: string): string {
  const { anio, mes: indice } = partesDeMes(mes);
  return formatearMesAnio(anio, indice);
}

/** "2026-10" → "oct". Es solo la etiqueta del gráfico: el nombre completo está en la tabla. */
export function etiquetaCortaDelMes(mes: string): string {
  const { anio, mes: indice } = partesDeMes(mes);
  return new Intl.DateTimeFormat('es-CL', { month: 'short' }).format(new Date(anio, indice, 1));
}

/** El monto de la API, listo para mostrar. Si no se le puede dar formato, se muestra tal cual y con su moneda. */
export function montoLegible(monto: string, moneda: string): string {
  return formatearAhorro(Number(monto), moneda) ?? `${monto} ${moneda}`;
}

/** El monto de la API como número, para dibujar. Un valor que no es número no inventa una barra. */
export function montoComoNumero(monto: string): number {
  const numero = Number(monto);
  return Number.isFinite(numero) ? numero : 0;
}

/** Sin un solo cobro, real ni previsto, en ninguno de los meses del informe. */
export function sinGastos(meses: readonly ResumenDelMes[]): boolean {
  return meses.every((mes) => montoComoNumero(mes.gasto_real) === 0 && montoComoNumero(mes.gasto_proyectado) === 0);
}

/**
 * El nombre del archivo que se descarga. Lleva el rango y la moneda: el servidor
 * no mezcla monedas, y dos descargas del mismo mes en monedas distintas no se
 * pueden confundir.
 */
export function nombreDelArchivoDeCobros(mes: string, moneda: string): string {
  const { desde, hasta } = rangoDelMes(mes);
  return `cobros_${desde}_${hasta}_${moneda}.csv`;
}

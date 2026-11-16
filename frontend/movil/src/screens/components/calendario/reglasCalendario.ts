import { formatearMonto, type CobroCalendario } from '@ojoalgasto/shared';

/** Los cobros de un día. El día elegido y la agenda salen de la misma lista, así no pueden diferir. */
export function cobrosDelDia(cobros: CobroCalendario[], dia: string): CobroCalendario[] {
  return cobros.filter((cobro) => cobro.fecha === dia);
}

/** Cuántos cobros hay en cada día, para marcar los días con cobro en la cuadrícula. */
export function contarPorDia(cobros: CobroCalendario[]): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const cobro of cobros) cuenta[cobro.fecha] = (cuenta[cobro.fecha] ?? 0) + 1;
  return cuenta;
}

/**
 * Total del mes por moneda. Nunca se suman importes de monedas distintas:
 * cada moneda lleva su propio total.
 */
export function totalesPorMoneda(cobros: CobroCalendario[]): { moneda: string; total: number }[] {
  const totales = new Map<string, number>();
  for (const cobro of cobros) totales.set(cobro.moneda, (totales.get(cobro.moneda) ?? 0) + cobro.importe);
  return [...totales].map(([moneda, total]) => ({ moneda, total }));
}

/** "$9.990". Una moneda desconocida haría fallar a Intl; en ese caso se muestra el número con su código. */
export function formatearImporte(importe: number, moneda: string): string {
  try {
    return formatearMonto(importe, moneda);
  } catch {
    return `${moneda} ${importe}`;
  }
}

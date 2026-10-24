/**
 * Formato regional. RNF-14A: es-CL por defecto para fechas, montos y
 * separadores. Se resuelve una vez acá, no en cada pantalla.
 */

import type { Moneda } from './tipos';

/** 0.5 → "0,5 h" · 12 → "12 h". Hasta dos decimales, con coma como en Chile. */
export function formatearHoras(horas: number): string {
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(horas)} h`;
}

/** 9900 → "$9.900" · 4.5 USD → "US$4,50" */
export function formatearMonto(monto: number, moneda: Moneda = 'CLP'): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: moneda,
  }).format(monto);
}

/** "2026-10-05" → "05 oct 2026". Se parte la fecha a mano para no depender de la zona horaria. */
export function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(anio, mes - 1, dia));
}

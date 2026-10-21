/**
 * Formato regional. RNF-14A: es-CL por defecto para fechas, montos y
 * separadores. Se resuelve una vez acá, no en cada pantalla.
 */

import type { Moneda } from './tipos';

/** 9900 → "$9.900" · 4.5 USD → "US$4,50" */
export function formatearMonto(monto: number, moneda: Moneda = 'CLP'): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: moneda === 'CLP' ? 0 : 2,
  }).format(monto);
}

/** "2026-10-05" → "05 oct 2026". Se parte la fecha a mano para no depender de la zona horaria. */
export function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(anio, mes - 1, dia));
}

/** (2026, 9) → "octubre de 2026". `mes` va de 0 a 11, igual que en Date. */
export function formatearMesAnio(anio: number, mes: number): string {
  return new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(new Date(anio, mes, 1));
}

/**
 * "2026-10-15" → "jueves, 15 de octubre de 2026". Es el nombre completo de
 * un día del calendario (lo lee el lector de pantalla). Igual que
 * formatearFecha, se parte a mano para que el día no cambie por la zona horaria.
 */
export function formatearFechaLarga(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(anio, mes - 1, dia));
}

/**
 * Fecha y hora de un instante ISO con zona (p. ej. la última sincronización
 * de una cuenta): "15 oct 2026, 02:30 p. m." en la hora local del navegador.
 * Acá sí se usa Date(iso): es un instante, no un día del calendario.
 */
export function formatearFechaHora(isoConHora: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoConHora));
}

// El 1 de enero de 2024 fue lunes: desde ahí se recorren los 7 días para
// sacar sus nombres del propio Intl, sin escribirlos a mano. Se guarda como
// números y no como un Date armado al cargar el módulo: un Date es un
// instante, y si la zona horaria cambia después (el navegador la actualiza
// si el equipo cambia de zona) ese instante cae el domingo 31 de diciembre.
const UN_LUNES = { anio: 2024, mes: 0, dia: 1 };

/** Nombres de los días de lunes a domingo (en Chile la semana parte el lunes). */
export function nombresDiasSemana(largo: 'short' | 'long'): string[] {
  const formato = new Intl.DateTimeFormat('es-CL', { weekday: largo });
  return Array.from({ length: 7 }, (_, i) =>
    formato.format(new Date(UN_LUNES.anio, UN_LUNES.mes, UN_LUNES.dia + i)),
  );
}

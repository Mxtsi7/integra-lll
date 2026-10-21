/**
 * Cuentas de la cuadrícula mensual del Calendario (CH-17). No van en shared/
 * porque son de presentación (cómo se dibuja un mes), igual que fechas.ts.
 *
 * Todo trabaja con fechas "YYYY-MM-DD" y con Date en hora LOCAL. Nunca con
 * new Date("2026-10-01"): eso es medianoche UTC y en Chile cae el 30 de
 * septiembre, y el cobro aparecería en el día equivocado.
 */

/** 0 → "sin cobros", 1 → "1 cobro", 3 → "3 cobros". */
export function textoCobros(cantidad: number): string {
  if (cantidad === 0) return 'sin cobros';
  return cantidad === 1 ? '1 cobro' : `${cantidad} cobros`;
}

/** "YYYY-MM-DD" de una fecha local. */
export function isoDeFecha(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Date local (medianoche) de un "YYYY-MM-DD". */
export function fechaDeIso(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

/** Días del mes (`mes` de 0 a 11). El día 0 del mes siguiente es el último de este. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate();
}

/** ¿La fecha ISO cae en ese mes? */
export function esDelMes(iso: string, anio: number, mes: number): boolean {
  const fecha = fechaDeIso(iso);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes;
}

/** Suma (o resta) días a una fecha ISO. Date corrige el cambio de mes y de año solo. */
export function sumarDias(iso: string, dias: number): string {
  const fecha = fechaDeIso(iso);
  fecha.setDate(fecha.getDate() + dias);
  return isoDeFecha(fecha);
}

/**
 * Las semanas del mes, de lunes a domingo (en Chile la semana parte el
 * lunes). Cada casilla es la fecha ISO o null si es de otro mes. Salen
 * entre 4 y 6 semanas según cómo caiga el día 1.
 */
export function semanasDelMes(anio: number, mes: number): (string | null)[][] {
  // getDay(): 0 = domingo … 6 = sábado. Corrido para que el lunes sea 0.
  const vaciasAlInicio = (new Date(anio, mes, 1).getDay() + 6) % 7;
  const casillas: (string | null)[] = Array.from({ length: vaciasAlInicio }, () => null);
  for (let dia = 1; dia <= diasDelMes(anio, mes); dia++) {
    casillas.push(isoDeFecha(new Date(anio, mes, dia)));
  }
  while (casillas.length % 7 !== 0) casillas.push(null);

  const semanas: (string | null)[][] = [];
  for (let i = 0; i < casillas.length; i += 7) semanas.push(casillas.slice(i, i + 7));
  return semanas;
}

// Fechas del calendario. Los días se manejan como texto "YYYY-MM-DD" y los meses como "YYYY-MM",
// igual que en la web (frontend/web/src/utils/calendario.ts) y que el backend. Nunca se pasa un día
// por UTC: así una fecha de cobro no se corre un día según la zona horaria del teléfono.
// TODO: si el equipo lo pide, mover estas funciones a `shared` y que la web también las use.

/** "YYYY-MM-DD" del día local de una fecha. */
export function isoDeFecha(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** "2026-11-09" → "2026-11". */
export function mesDeFecha(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-11" → { anio: 2026, mes: 10 }. El mes va de 0 a 11, como en Date. */
export function partesDeMes(clave: string): { anio: number; mes: number } {
  const [anio, mes] = clave.split('-').map(Number);
  return { anio, mes: mes - 1 };
}

/** Suma o resta meses: "2026-12" + 1 → "2027-01"; "2026-01" − 1 → "2025-12". */
export function sumarMeses(clave: string, cantidad: number): string {
  const { anio, mes } = partesDeMes(clave);
  return mesDeFecha(isoDeFecha(new Date(anio, mes + cantidad, 1)));
}

export function primerDiaDelMes(clave: string): string {
  return `${clave}-01`;
}

/** ¿El día "YYYY-MM-DD" pertenece al mes "YYYY-MM"? */
export function esDelMes(iso: string, clave: string): boolean {
  return mesDeFecha(iso) === clave;
}

/**
 * Las semanas del mes, de lunes a domingo (en Chile la semana parte el lunes).
 * Las casillas que no son del mes van como null.
 */
export function semanasDelMes(clave: string): (string | null)[][] {
  const { anio, mes } = partesDeMes(clave);
  const casillasVaciasAlInicio = (new Date(anio, mes, 1).getDay() + 6) % 7; // getDay(): 0 = domingo
  const diasDelMes = new Date(anio, mes + 1, 0).getDate();

  const casillas: (string | null)[] = Array.from({ length: casillasVaciasAlInicio }, () => null);
  for (let dia = 1; dia <= diasDelMes; dia += 1) {
    casillas.push(isoDeFecha(new Date(anio, mes, dia)));
  }
  while (casillas.length % 7 !== 0) casillas.push(null);

  const semanas: (string | null)[][] = [];
  for (let inicio = 0; inicio < casillas.length; inicio += 7) {
    semanas.push(casillas.slice(inicio, inicio + 7));
  }
  return semanas;
}

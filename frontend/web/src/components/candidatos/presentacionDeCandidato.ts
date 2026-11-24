import { formatearFecha, type CandidatoDetectado } from '@ojoalgasto/shared';

/*
 * S3-CH-05: cómo se dicen el importe, la moneda, la fecha y el origen de un candidato. Todo sale
 * de lo que mandó la API (contrato común v1, docs/contratos/candidatos-v1.md): lo que falta o no
 * se entiende se dice como tal, y no se completa con un valor inventado.
 */

type DatosDelImporte = Pick<CandidatoDetectado, 'importe' | 'moneda'>;
type DatosDeLaFecha = Pick<CandidatoDetectado, 'fecha' | 'tipo_mensaje' | 'evidencia'>;
type DatosDelOrigen = Pick<CandidatoDetectado, 'origen' | 'origen_legible' | 'evidencia'>;

// ── Fecha ────────────────────────────────────────────────────────────

export const FECHA_SIN_INDICAR = 'fecha sin indicar';

/** "2026-10-28" es un día del calendario; "2026-02-30", "" o "ayer" no lo son. No se corrige ni se completa. */
export function esFechaReal(texto: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (partes === null) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
}

/** La fecha con formato, o null si la API no mandó un día real. `formatearFecha` lanza con una fecha inválida. */
export function fechaLegible(fecha: string): string | null {
  return esFechaReal(fecha) ? formatearFecha(fecha) : null;
}

/** Para leerla en una etiqueta: la fecha con formato, o que no se indicó. */
export function fechaParaLeer(fecha: string): string {
  return fechaLegible(fecha) ?? FECHA_SIN_INDICAR;
}

/**
 * Qué día es el de cada tipo de mensaje (contrato v1): el del cobro o el intento, y en un aviso el
 * del cobro anunciado. Un Map y no un objeto: un tipo como "constructor" no debe encontrar nada.
 */
const FRASE_DE_LA_FECHA_POR_TIPO = new Map<string, (fecha: string) => string>([
  ['cobro_realizado', (fecha) => `el ${fecha}`],
  ['aviso_de_cobro', (fecha) => `previsto para el ${fecha}`],
  ['pago_fallido', (fecha) => `intento el ${fecha}`],
]);

/**
 * Lo que dice la fecha de un candidato. Si el correo no traía la fecha del cobro y el productor usó
 * la de recepción como supuesto (`evidencia.fecha_origen = "recepcion"`), se dice: no es la del cobro.
 */
export function fraseDeLaFecha({ fecha, tipo_mensaje, evidencia }: DatosDeLaFecha): string {
  const legible = fechaLegible(fecha);
  if (legible === null) return FECHA_SIN_INDICAR;
  if (evidencia.fecha_origen === 'recepcion') {
    return `sin fecha de cobro: se usó la de recepción del correo (${legible})`;
  }
  const frase = FRASE_DE_LA_FECHA_POR_TIPO.get(tipo_mensaje);
  return frase === undefined ? `fecha ${legible}` : frase(legible);
}

// ── Origen ───────────────────────────────────────────────────────────

/** De dónde salió el cobro, y la fila del archivo cuando es de un CSV: sirve para encontrarla en la cartola. */
export function procedenciaLegible({ origen, origen_legible, evidencia }: DatosDelOrigen): string {
  const fila = origen === 'csv' ? evidencia.fila : undefined;
  const filaVisible = typeof fila === 'string' && fila.trim() !== '' ? `fila ${fila.trim()}` : null;
  return [origen_legible, filaVisible].filter((parte): parte is string => parte !== null && parte !== '').join(' · ');
}

// ── Importe y moneda ─────────────────────────────────────────────────

/** Más dígitos que estos no caben en un número sin perder precisión. */
const MAXIMO_DIGITOS_EXACTOS = 15;

export const MONEDA_SIN_INDICAR = 'moneda sin indicar';

export interface ImporteDelCandidato {
  /** El importe listo para mostrar. Cuando no se le pudo dar formato ya lleva la moneda que mandó la API. */
  texto: string;
  /** El código de la moneda, aparte, solo cuando el texto es un monto con formato y no lo incluye. */
  moneda: string | null;
}

/** Cuántos decimales trae el importe sin contar los ceros de la derecha: "5900.50" → 1, "5900.00" → 0. */
function decimalesSignificativos(importe: string): number {
  const decimales = /^[+-]?\d*\.(\d+)$/.exec(importe.trim())?.[1] ?? '';
  return decimales.replace(/0+$/, '').length;
}

/**
 * El monto con el formato de su moneda, sin redondear: si el importe trae más decimales de los que usa
 * la moneda (5900.50 en pesos), se muestran todos, porque redondear sería mostrar otro importe.
 */
function formatearSinRedondear(monto: number, moneda: string, decimalesDelImporte: number): string {
  const porDefecto = new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda }).resolvedOptions();
  const decimales = Math.max(porDefecto.minimumFractionDigits ?? 0, decimalesDelImporte);
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(monto);
}

/**
 * El importe y la moneda de la API, sin inventar nada:
 * - un monto y una moneda válidos se muestran con su formato, y el código de la moneda aparte;
 * - sin moneda, se dice que no se indicó, en vez de suponer pesos;
 * - un importe que no es un número, o que tiene más dígitos que un número exacto, o una moneda que
 *   Intl no entiende, se muestran tal cual, con la moneda que mandó la API.
 */
export function importeDelCandidato({ importe, moneda }: DatosDelImporte): ImporteDelCandidato {
  const codigo = moneda.trim();
  if (codigo === '') {
    return { texto: [importe.trim(), `(${MONEDA_SIN_INDICAR})`].filter((parte) => parte !== '').join(' '), moneda: null };
  }

  const crudo: ImporteDelCandidato = { texto: `${importe} ${moneda}`.trim(), moneda: null };
  const monto = Number(importe);
  const digitos = importe.replace(/\D/g, '').length;
  if (importe.trim() === '' || !Number.isFinite(monto) || digitos > MAXIMO_DIGITOS_EXACTOS) return crudo;
  try {
    return { texto: formatearSinRedondear(monto, codigo, decimalesSignificativos(importe)), moneda: codigo };
  } catch (error) {
    // Intl rechaza un código de moneda que no existe: en ese caso se muestra el dato crudo.
    if (error instanceof RangeError) return crudo;
    throw error;
  }
}

/** El importe con su moneda en una sola frase, para leerlo en una etiqueta. */
export function importeParaLeer(importe: ImporteDelCandidato): string {
  return importe.moneda === null ? importe.texto : `${importe.texto} ${importe.moneda}`;
}

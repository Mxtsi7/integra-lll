// Validaciones de los formularios de suscripción y de uso.
//
// Copian las reglas del backend para avisar antes de enviar; el backend
// sigue siendo la validación definitiva y sus errores se muestran igual
// (ver erroresDesdeServidor). Fuente de cada regla en services/subscriptions:
// - Subscription (app/models.py): nombre máx. 100, monto DecimalField(10, 2)
//   y > 0, fechas DateField.
// - Moneda, categoría y frecuencia: las opciones válidas vienen del catálogo
//   del backend (GET /catalogos/suscripciones/), no de una lista escrita acá.
// - SubscriptionSerializer.validate_monto: "El monto debe ser mayor a 0."
// - RegistrarUsoSerializer: minutos enteros entre 1 y 44.640, fecha no futura.

export const LARGO_MAXIMO_NOMBRE_SUSCRIPCION = 100;
/** DecimalField(max_digits=10, decimal_places=2): 8 enteros y 2 decimales. */
export const MONTO_MAXIMO = 99_999_999.99;
/** 24 h × 60 min × 31 días, el tope del backend. */
export const MINUTOS_MAXIMOS_USO = 44_640;

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * true si `iso` es una fecha que existe (YYYY-MM-DD). "2026-02-30" o
 * "2026-13-01" no existen aunque tengan el formato correcto.
 */
export function esFechaReal(iso: string): boolean {
  const partes = FECHA_ISO.exec(iso);
  if (!partes) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  if (anio < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  // Date.UTC "corre" las fechas imposibles (30 de febrero → 2 de marzo):
  // si al volver no da el mismo día, no existía.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

/** Fecha de hoy en la zona horaria del usuario, como YYYY-MM-DD. */
export function hoyLocalIso(ahora: Date = new Date()): string {
  const mm = String(ahora.getMonth() + 1).padStart(2, '0');
  const dd = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mm}-${dd}`;
}

/**
 * Convierte el texto del campo monto en número, o explica por qué no se
 * puede. Acepta coma o punto decimal. Rechaza exponentes ("1e400", que
 * parseFloat convierte en Infinity) y texto sobrante ("12abc").
 */
export function parsearMonto(texto: string): { valor: number } | { error: string } {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return { error: 'Ingresa el monto.' };
  if (/^-/.test(limpio)) return { error: 'El monto debe ser mayor a 0.' };
  if (/^\d+\.\d{3,}$/.test(limpio)) return { error: 'Usa como máximo 2 decimales.' };
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return { error: 'Ingresa un monto válido, solo con números.' };
  const valor = Number(limpio);
  if (!Number.isFinite(valor)) return { error: 'Ingresa un monto válido, solo con números.' };
  if (valor <= 0) return { error: 'El monto debe ser mayor a 0.' };
  if (valor > MONTO_MAXIMO) return { error: 'El monto no puede superar 99.999.999,99.' };
  return { valor };
}

export type DatosSuscripcion = {
  nombre: string;
  monto: string;
  moneda: string;
  categoria: string;
  frecuencia: string;
  fechaProximoCobro: string;
  /** Si está en período de prueba, la fecha de fin es obligatoria. */
  enPrueba: boolean;
  finPrueba: string;
};

export type CampoSuscripcion =
  | 'nombre'
  | 'monto'
  | 'moneda'
  | 'frecuencia'
  | 'categoria'
  | 'fechaProximoCobro'
  | 'finPrueba';
export type ErroresSuscripcion = Partial<Record<CampoSuscripcion, string>>;

/**
 * Códigos que hoy se pueden elegir, sacados del catálogo del backend (las
 * opciones activas). Si el catálogo agrega una moneda o una categoría, vale
 * sin tocar este archivo.
 */
export type OpcionesSuscripcion = {
  monedas: readonly string[];
  categorias: readonly string[];
  frecuencias: readonly string[];
};

/** Valida el formulario de creación (CH-09). Objeto vacío = se puede enviar. */
export function validarSuscripcion(datos: DatosSuscripcion, opciones: OpcionesSuscripcion): ErroresSuscripcion {
  const errores: ErroresSuscripcion = {};

  const nombre = datos.nombre.trim();
  if (!nombre) errores.nombre = 'Ingresa el nombre del servicio.';
  else if (nombre.length > LARGO_MAXIMO_NOMBRE_SUSCRIPCION) {
    errores.nombre = `El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE_SUSCRIPCION} caracteres.`;
  }

  const monto = parsearMonto(datos.monto);
  if ('error' in monto) errores.monto = monto.error;

  // Vacío o una opción que el catálogo ya no ofrece (p. ej. se desactivó
  // mientras el formulario estaba abierto).
  if (!opciones.monedas.includes(datos.moneda)) errores.moneda = 'Elige una moneda de la lista.';
  if (!opciones.categorias.includes(datos.categoria)) errores.categoria = 'Elige una categoría de la lista.';
  if (!opciones.frecuencias.includes(datos.frecuencia)) errores.frecuencia = 'Elige cada cuánto se cobra.';

  if (!datos.fechaProximoCobro) errores.fechaProximoCobro = 'Ingresa la fecha del próximo cobro.';
  else if (!esFechaReal(datos.fechaProximoCobro)) errores.fechaProximoCobro = 'Esa fecha no existe.';

  if (datos.enPrueba) {
    if (!datos.finPrueba) errores.finPrueba = 'Ingresa cuándo termina la prueba.';
    else if (!esFechaReal(datos.finPrueba)) errores.finPrueba = 'Esa fecha no existe.';
  }

  return errores;
}

export type CampoUso = 'minutos' | 'fecha';
export type ErroresUso = Partial<Record<CampoUso, string>>;

/**
 * Valida el registro de minutos de uso (CH-14). Mismos mensajes que
 * RegistrarUsoSerializer. `fecha` vacía es válida: el backend usa hoy.
 */
export function validarUso(datos: { minutos: string; fecha: string }, hoy: string = hoyLocalIso()): ErroresUso {
  const errores: ErroresUso = {};
  const texto = datos.minutos.trim();

  if (!texto) errores.minutos = 'Ingresa los minutos de uso.';
  else if (/^-/.test(texto) || /^0+$/.test(texto)) {
    errores.minutos = 'Los minutos de uso no pueden ser negativos ni cero.';
  } else if (!/^\d+$/.test(texto)) errores.minutos = 'Los minutos deben ser un número entero válido.';
  else if (Number(texto) > MINUTOS_MAXIMOS_USO) {
    errores.minutos = 'Los minutos de uso no pueden superar el máximo mensual (44.640 minutos).';
  }

  if (datos.fecha) {
    if (!esFechaReal(datos.fecha)) errores.fecha = 'Esa fecha no existe.';
    // Las fechas ISO se comparan bien como texto.
    else if (datos.fecha > hoy) errores.fecha = 'No se puede registrar uso de una fecha futura.';
  }

  return errores;
}

/**
 * Reparte los errores por campo del backend (formato DRF) entre los campos
 * de un formulario según `mapa` (nombre en la API → nombre en el form). Lo
 * que no corresponde a ningún campo va en `general`, para no perderlo.
 */
export function erroresDesdeServidor<C extends string>(
  campos: Record<string, string[]>,
  mapa: Record<string, C>,
): { porCampo: Partial<Record<C, string>>; general: string[] } {
  const porCampo: Partial<Record<C, string>> = {};
  const general: string[] = [];
  for (const [campoApi, mensajes] of Object.entries(campos)) {
    const campo = mapa[campoApi];
    if (campo && mensajes.length > 0) porCampo[campo] = mensajes.join(' ');
    else general.push(...mensajes);
  }
  return { porCampo, general };
}

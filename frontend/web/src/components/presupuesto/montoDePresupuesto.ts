/**
 * S3-CH-27: lee el monto que la persona escribe en el formulario del presupuesto. Devuelve el
 * texto decimal con punto que espera el servidor ("5900" o "5900.50") o el motivo por el que
 * no se puede usar. Nada se redondea, se completa ni se adivina.
 */

/** El servidor guarda 10 dígitos con 2 decimales (DecimalField): quedan 8 para los enteros. */
export const MAXIMO_DE_ENTEROS = 8;
export const MAXIMO_DE_DECIMALES = 2;

export const MENSAJE_MONTO_VACIO = 'Escribe el monto del presupuesto.';
export const MENSAJE_MONTO_CON_FORMATO_INVALIDO =
  'Escribe solo números, sin símbolos ni separador de miles. Por ejemplo: 200000 o 200000,50.';
export const MENSAJE_MONTO_CON_DEMASIADOS_DECIMALES = `Usa como máximo ${MAXIMO_DE_DECIMALES} decimales.`;
export const MENSAJE_MONTO_DEMASIADO_GRANDE = `El monto puede tener hasta ${MAXIMO_DE_ENTEROS} dígitos antes de los decimales.`;
export const MENSAJE_MONTO_NO_POSITIVO = 'El monto debe ser mayor a 0.';

export type MontoEscrito = { valido: true; monto: string } | { valido: false; mensaje: string };

/** Dígitos, y si hay separador decimal (punto o coma) uno solo con dígitos después. */
const FORMATO_DEL_MONTO = /^(\d+)(?:[.,](\d+))?$/;

/** Un separador seguido de exactamente tres dígitos: "5.900" puede ser cinco mil novecientos o 5,9. */
const DECIMALES_QUE_PARECEN_MILES = 3;

function noValido(mensaje: string): MontoEscrito {
  return { valido: false, mensaje };
}

export function leerMontoEscrito(textoEscrito: string): MontoEscrito {
  const texto = textoEscrito.trim();
  if (texto === '') return noValido(MENSAJE_MONTO_VACIO);

  const partes = FORMATO_DEL_MONTO.exec(texto);
  if (partes === null) return noValido(MENSAJE_MONTO_CON_FORMATO_INVALIDO);
  const [, enteros, decimales = ''] = partes;

  // Se pide reescribirlo en vez de elegir una de las dos lecturas: un presupuesto mil veces
  // más chico o más grande que el que se quería no se nota hasta que ya está guardado.
  if (decimales.length === DECIMALES_QUE_PARECEN_MILES) return noValido(MENSAJE_MONTO_CON_FORMATO_INVALIDO);
  if (decimales.length > MAXIMO_DE_DECIMALES) return noValido(MENSAJE_MONTO_CON_DEMASIADOS_DECIMALES);

  const enterosSinCerosAlInicio = enteros.replace(/^0+(?=\d)/, '');
  if (enterosSinCerosAlInicio.length > MAXIMO_DE_ENTEROS) return noValido(MENSAJE_MONTO_DEMASIADO_GRANDE);
  if (/^0*$/.test(enteros + decimales)) return noValido(MENSAJE_MONTO_NO_POSITIVO);

  return { valido: true, monto: decimales === '' ? enterosSinCerosAlInicio : `${enterosSinCerosAlInicio}.${decimales}` };
}

/**
 * El monto guardado, como se escribiría para cambiarlo: "200000.00" → "200000", "5900.50" →
 * "5900.5". Solo se quitan ceros de la derecha de los decimales; el valor es el mismo.
 */
export function montoParaEditar(montoGuardado: string): string {
  return montoGuardado.includes('.') ? montoGuardado.replace(/0+$/, '').replace(/\.$/, '') : montoGuardado;
}

import { esMesValido } from './calendario';
import { pedir } from './cliente';

/** Código de moneda como lo pide el servidor: tres letras mayúsculas ("CLP"). */
const FORMATO_MONEDA = /^[A-Z]{3}$/;

/**
 * La comparación de un presupuesto mensual (PresupuestoComparacionSerializer, VI-05) para UN
 * mes y UNA moneda. Los montos llegan como texto para no perder exactitud, y las monedas no se
 * mezclan: cada respuesta es solo de la que se pidió. Todo lo calcula el servidor sobre los
 * cobros y las suscripciones completas de la organización; la web no suma ni compara nada.
 *
 * - `presupuesto` y `diferencia` son null cuando ese mes y esa moneda no tienen presupuesto
 *   definido. No es lo mismo que un presupuesto de 0 (el servidor no los admite) ni que un
 *   gasto de 0: sin presupuesto, `porcentaje_consumido` es 0 y no significa nada.
 * - `total_esperado`: el gasto real más el proyectado.
 * - `diferencia`: el presupuesto menos el total esperado (negativa si se pasa).
 * - `porcentaje_consumido`: el total esperado sobre el presupuesto, en porcentaje.
 * - `alerta_superado`: si el total esperado pasa del presupuesto.
 */
export interface ComparacionDePresupuesto {
  /** "YYYY-MM". */
  mes: string;
  moneda: string;
  presupuesto: string | null;
  gasto_real: string;
  gasto_proyectado: string;
  total_esperado: string;
  diferencia: string | null;
  porcentaje_consumido: number;
  alerta_superado: boolean;
}

/** PresupuestoSerializer (VI-05): el presupuesto que quedó guardado. */
export interface PresupuestoGuardado {
  id: string;
  /** "YYYY-MM". */
  mes: string;
  moneda: string;
  monto: string;
  creado_en: string;
  actualizado_en: string;
}

/** Lo que se guarda: el monto de un mes en una moneda. */
export interface DatosDePresupuesto {
  /** "YYYY-MM". */
  mes: string;
  moneda: string;
  /** Decimal positivo como texto con punto ("5900" o "5900.50"), de hasta 8 enteros y 2 decimales. */
  monto: string;
}

/**
 * Sin mes o sin moneda el servidor no falla: toma el mes de hoy y los pesos chilenos. Para un
 * presupuesto eso sería guardar o mostrar otra cosa de la que se eligió, así que aquí se exige
 * lo uno y lo otro antes de salir.
 */
function exigirMesYMoneda(mes: string, moneda: string): void {
  if (!esMesValido(mes)) throw new RangeError(`Mes inválido: "${mes}". Debe ser YYYY-MM.`);
  if (!FORMATO_MONEDA.test(moneda)) throw new RangeError(`Moneda inválida: "${moneda}". Deben ser tres letras mayúsculas.`);
}

/**
 * GET /api/suscripciones/presupuesto/?mes=YYYY-MM&moneda=XXX (VI-05): el presupuesto de ese
 * mes y esa moneda frente al gasto real y al proyectado. Una moneda fuera del catálogo
 * responde 400.
 */
export async function getComparacionDePresupuesto(mes: string, moneda: string): Promise<ComparacionDePresupuesto> {
  exigirMesYMoneda(mes, moneda);
  const consulta = new URLSearchParams({ mes, moneda });
  return await pedir(`/suscripciones/presupuesto/?${consulta.toString()}`);
}

/**
 * POST /api/suscripciones/presupuesto/ (VI-05): define el presupuesto de un mes y una moneda,
 * o lo reemplaza si ya existía (no se crea uno nuevo por cada guardado). Responde solo lo
 * guardado: para comparar con el gasto hay que volver a pedir la comparación.
 *
 * Los errores de validación (monto que no es mayor a 0 o con demasiados dígitos, moneda fuera
 * del catálogo) llegan como `ErrorDeApi` 400 con el detalle en `campos`; sin organización
 * activa, un 403. El servidor no tiene forma de borrar un presupuesto.
 */
export async function guardarPresupuesto({ mes, moneda, monto }: DatosDePresupuesto): Promise<PresupuestoGuardado> {
  exigirMesYMoneda(mes, moneda);
  return await pedir('/suscripciones/presupuesto/', { method: 'POST', body: { mes, moneda, monto } });
}

/**
 * Cálculos del dominio. Viven acá y no en las pantallas para que la web y
 * la app móvil muestren exactamente el mismo número.
 */

import type { Frecuencia, Moneda, Suscripcion } from './tipos';

/** RN-CIC-005: los cobros anuales se convierten a equivalente mensual. */
export function equivalenteMensual(monto: number, frecuencia: Frecuencia): number {
  return frecuencia === 'anual' ? monto / 12 : monto;
}

/** Unidad común exacta para importes del contrato de dos decimales. */
function doceavosDeCentavo(s: Suscripcion): number {
  return Math.round(s.monto * 100) * (s.frecuencia === 'anual' ? 1 : 12);
}

/**
 * Suma una selección de la misma moneda, sin cambiar sus estados ni redondear.
 * El único redondeo se hace al presentar con formatearMonto (CLP sin decimales).
 */
export function sumarEquivalentesMensuales(suscripciones: Suscripcion[]): number {
  if (new Set(suscripciones.map((s) => s.moneda)).size > 1) {
    throw new RangeError('El gasto debe calcularse por moneda.');
  }
  return suscripciones.reduce((suma, s) => suma + doceavosDeCentavo(s), 0) / 1200;
}

/**
 * La métrica que distingue al producto: cuánto cuesta cada hora efectivamente
 * usada. Un servicio de $9.900 usado dos horas al mes cuesta $4.950 la hora.
 *
 * Sin horas de uso no hay costo por hora: devuelve null, y la pantalla decide
 * cómo mostrarlo. No se devuelve Infinity para que nadie lo sume por error.
 */
export function costoPorHora(montoMensual: number, horasUsoMes: number): number | null {
  if (horasUsoMes <= 0) return null;
  return montoMensual / horasUsoMes;
}

/**
 * RN-CIC-005: qué suscripciones van a cobrarse. Las activas y las pruebas
 * gratuitas con fecha de término y monto conocidos.
 *
 * Una suscripción fantasma sigue cobrándose —es activa sin uso—, así que
 * cuenta. Ocultarla escondería justo el gasto que el producto existe para
 * mostrar. Una cancelada o una por confirmar no tienen un cobro seguro.
 *
 * La usa la proyección del Panel. El Calendario ya no: desde CH-18 los
 * cobros del mes los calcula el backend (VI-07).
 */
export function generaCobro(s: Suscripcion): boolean {
  if (s.estado === 'activo' || s.estado === 'fantasma') return true;
  if (s.estado === 'prueba') return s.monto > 0 && Boolean(s.fin_prueba);
  return false;
}

/**
 * RN-CIC-005: el gasto mensual proyectado suma, en equivalente mensual, las
 * suscripciones que generan cobro (ver generaCobro).
 */
export function gastoProyectado(suscripciones: Suscripcion[]): number {
  if (new Set(suscripciones.filter(generaCobro).map((s) => s.moneda)).size > 1) {
    throw new RangeError('El gasto debe calcularse por moneda.');
  }
  return gastosPorMoneda(suscripciones)[0]?.total ?? 0;
}

/** Proyección de toda la lista, sin convertir ni mezclar divisas. */
export function gastosPorMoneda(suscripciones: Suscripcion[]): { moneda: Moneda; total: number }[] {
  // Mismas unidades que sumarEquivalentesMensuales; se redondea solo al presentar.
  const sumas = new Map<Moneda, number>();
  for (const s of suscripciones.filter(generaCobro)) {
    const unidades = doceavosDeCentavo(s);
    sumas.set(s.moneda, (sumas.get(s.moneda) ?? 0) + unidades);
  }
  return [...sumas].map(([moneda, unidades]) => ({ moneda, total: unidades / 1200 }));
}

/** Cuántas suscripciones hay en cada estado. Alimenta el conteo del panel (RF-09). */
export function conteoPorEstado(suscripciones: Suscripcion[]): Record<Suscripcion['estado'], number> {
  const conteo = { prueba: 0, activo: 0, por_confirmar: 0, cancelado: 0, fantasma: 0 };
  for (const s of suscripciones) conteo[s.estado] += 1;
  return conteo;
}

/**
 * Suma montos separados por moneda (CH-20, CH-21): pesos y dólares no se
 * suman entre sí. Se suma en centavos para que 4,99 + 4,99 dé 9,98 exacto y
 * no 9,980000000000001. El orden es el de la primera aparición de cada moneda.
 */
export function totalesPorMoneda(montos: { importe: number; moneda: Moneda }[]): { moneda: Moneda; total: number }[] {
  const centavos = new Map<Moneda, number>();
  for (const { importe, moneda } of montos) {
    centavos.set(moneda, (centavos.get(moneda) ?? 0) + Math.round(importe * 100));
  }
  return [...centavos].map(([moneda, total]) => ({ moneda, total: total / 100 }));
}

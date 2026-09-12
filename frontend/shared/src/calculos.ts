/**
 * Cálculos del dominio. Viven acá y no en las pantallas para que la web y
 * la app móvil muestren exactamente el mismo número.
 */

import type { Frecuencia, Suscripcion } from './tipos';

/** RN-CIC-005: los cobros anuales se convierten a equivalente mensual. */
export function equivalenteMensual(monto: number, frecuencia: Frecuencia): number {
  return frecuencia === 'anual' ? monto / 12 : monto;
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
 * RN-CIC-005: el gasto mensual proyectado incluye las suscripciones activas y
 * las pruebas gratuitas con fecha de término y monto conocidos, todo en
 * equivalente mensual.
 *
 * Una suscripción fantasma sigue cobrándose —es activa sin uso—, así que
 * entra en la proyección. Ocultarla escondería justo el gasto que el producto
 * existe para mostrar.
 */
export function gastoProyectado(suscripciones: Suscripcion[]): number {
  return suscripciones
    .filter((s) => {
      if (s.estado === 'activo' || s.estado === 'fantasma') return true;
      if (s.estado === 'prueba') return s.monto > 0 && Boolean(s.fin_prueba);
      return false;
    })
    .reduce((total, s) => total + equivalenteMensual(s.monto, s.frecuencia), 0);
}

/** Cuántas suscripciones hay en cada estado. Alimenta el conteo del panel (RF-09). */
export function conteoPorEstado(suscripciones: Suscripcion[]): Record<Suscripcion['estado'], number> {
  const conteo = { prueba: 0, activo: 0, por_confirmar: 0, cancelado: 0, fantasma: 0 };
  for (const s of suscripciones) conteo[s.estado] += 1;
  return conteo;
}

import { formatearMonto, type CobroCalendario, type TipoCobroCalendario } from '@ojoalgasto/shared';
import type { TonoInsignia } from '../ui/Insignia';

/**
 * Cómo se muestra cada tipo de cobro de VI-07 (CH-18). "proyectado" se dice
 * "Previsto": es un cobro que se espera por la frecuencia, todavía no ocurrió.
 * Es un Record completo: si el backend agrega un tipo, TypeScript obliga a
 * darle texto y color.
 */
export const PRESENTACION_TIPO: Record<TipoCobroCalendario, { etiqueta: string; tono: TonoInsignia }> = {
  confirmado: { etiqueta: 'Confirmado', tono: 'verde' },
  proyectado: { etiqueta: 'Previsto', tono: 'neutro' },
};

/** "Netflix, $9.990, previsto": lo que lee el lector de pantalla de un cobro. */
export function describirCobro(cobro: CobroCalendario): string {
  return `${cobro.servicio}, ${formatearMonto(cobro.importe, cobro.moneda)}, ${PRESENTACION_TIPO[cobro.tipo].etiqueta.toLowerCase()}`;
}

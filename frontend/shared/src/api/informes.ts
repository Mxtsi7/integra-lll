import { pedir } from './cliente';

/** Cuántas suscripciones hay en cada estado (ConteoEstadosSerializer). No depende del mes ni de la moneda. */
export interface ConteoEstados {
  activo: number;
  prueba: number;
  por_confirmar: number;
  cancelado: number;
  fantasma: number;
  total: number;
}

/**
 * ResumenPanelSerializer (VI-06): el gasto de UN mes en UNA moneda. Los montos llegan
 * como texto para no perder exactitud. Las monedas no se mezclan: cada respuesta es
 * solo de la que se pidió.
 * - `gasto_real`: los cobros del mes.
 * - `gasto_proyectado`: lo que falta por cobrar del mes según las suscripciones vigentes.
 *   Un mes que ya pasó no proyecta nada.
 * - `total_estimado`: la suma de los dos.
 */
export interface ResumenDelMes {
  /** "YYYY-MM". */
  periodo: string;
  moneda: string;
  gasto_real: string;
  gasto_proyectado: string;
  total_estimado: string;
  conteo_estados: ConteoEstados;
}

/**
 * GET /api/suscripciones/resumen/?mes=YYYY-MM&moneda=XXX (VI-06). El servidor valida
 * las dos cosas: un mes mal escrito o una moneda fuera del catálogo responde 400.
 */
export async function getResumenDelMes(mes: string, moneda: string): Promise<ResumenDelMes> {
  const consulta = new URLSearchParams({ mes, moneda });
  return await pedir(`/suscripciones/resumen/?${consulta.toString()}`);
}

/** Lo que pide la exportación: un rango inclusivo de fechas y una moneda. */
export interface ConsultaExportacionCobros {
  /** "YYYY-MM-DD". */
  desde: string;
  /** "YYYY-MM-DD", igual o posterior a `desde`. */
  hasta: string;
  moneda: string;
}

/** El primer y el último día de un mes "YYYY-MM": el rango inclusivo que pide la exportación. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, numeroDeMes] = mes.split('-').map(Number);
  // El día 0 del mes siguiente es el último de este (los meses de Date van de 0 a 11).
  const ultimoDia = new Date(Date.UTC(anio, numeroDeMes, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimoDia).padStart(2, '0')}` };
}

/**
 * GET /api/suscripciones/exportar-csv/?desde=&hasta=&moneda= (VI-25). Devuelve el texto
 * del CSV con una fila por cobro del rango y de la moneda, completo: no depende de
 * ninguna página de la API. Sin rango o con uno al revés responde 400.
 */
export async function exportarCobrosCsv({ desde, hasta, moneda }: ConsultaExportacionCobros): Promise<string> {
  const consulta = new URLSearchParams({ desde, hasta, moneda });
  return await pedir(`/suscripciones/exportar-csv/?${consulta.toString()}`, { respuesta: 'texto' });
}

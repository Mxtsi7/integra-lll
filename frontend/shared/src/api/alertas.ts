import { pedir, type Paginado } from './cliente';

/** Los cinco tipos de `Alerta.Tipo` (FE-16). Uno nuevo del backend llega como texto y se muestra igual. */
export type TipoAlerta = 'proximo_cobro' | 'fin_prueba' | 'alza_tarifa' | 'doble_cobro' | 'presupuesto_excedido';

/**
 * El estado de lectura. `revisada` no es lo mismo que `leida`: es una alerta
 * descartada (RF-07), que también dejó de contar como sin leer.
 */
export type LecturaAlerta = 'pendiente' | 'leida' | 'revisada';

/** AlertaSerializer de FE-19: todo de solo lectura; el estado cambia con las acciones. */
export interface Alerta {
  id: string;
  tipo: TipoAlerta;
  tipo_legible: string;
  titulo: string;
  mensaje: string;
  /** Vacío en las que no son de una suscripción, como el presupuesto excedido. */
  suscripcion_id: string | null;
  /** Lo propio de cada tipo (montos de un alza, fechas de un doble cobro). */
  datos: Record<string, unknown>;
  lectura: LecturaAlerta;
  lectura_legible: string;
  /** Lo que cuenta la campana: `lectura === 'pendiente'`. */
  pendiente: boolean;
  leida_en: string | null;
  revisada_en: string | null;
  creado_en: string;
}

/** Lo que muestra la campana (FE-20): de toda la organización, no de una página. */
export interface ContadorAlertas {
  pendientes: number;
  total: number;
}

/**
 * Cuántas pide cada página. Se manda siempre en vez de confiar en el valor
 * por omisión del backend: con él se calcula cuántas páginas hay.
 */
export const TAMANO_PAGINA_ALERTAS = 10;

export interface ConsultaAlertas {
  /** Sin valor, todas. */
  lectura?: LecturaAlerta;
  /** Empieza en 1. */
  pagina?: number;
}

/**
 * GET /api/alertas/ (FE-19), de la más nueva a la más vieja. Una página que
 * ya no existe responde 404, como cualquier paginador de DRF.
 */
export async function getAlertas({ lectura, pagina = 1 }: ConsultaAlertas = {}): Promise<Paginado<Alerta>> {
  const consulta = new URLSearchParams({ page: String(pagina), page_size: String(TAMANO_PAGINA_ALERTAS) });
  if (lectura) consulta.set('lectura', lectura);
  return await pedir(`/alertas/?${consulta.toString()}`);
}

/** GET /api/alertas/contador/ (FE-20). */
export async function getContadorAlertas(): Promise<ContadorAlertas> {
  return await pedir('/alertas/contador/');
}

/**
 * POST /api/alertas/<id>/leer/ (FE-20). Idempotente: si ya estaba leída o
 * revisada, el backend la devuelve tal cual y no la descuenta otra vez.
 */
export async function marcarAlertaLeida(id: string): Promise<Alerta> {
  return await pedir(`/alertas/${encodeURIComponent(id)}/leer/`, { method: 'POST' });
}

/** POST /api/alertas/leer-todas/ (FE-20). `leidas` es cuántas cambiaron. */
export async function marcarTodasLasAlertasLeidas(): Promise<{ leidas: number }> {
  return await pedir('/alertas/leer-todas/', { method: 'POST' });
}

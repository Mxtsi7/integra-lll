import { pedir, type Paginado } from './cliente';

/** De dónde salió el cobro: el CSV de una importación o un correo (S3-FE-14). */
export type OrigenCandidato = 'csv' | 'correo';

/** Qué dice el archivo o el correo sobre el cobro (CobroCandidato.TipoMensaje). */
export type TipoMensajeCandidato = 'cobro_realizado' | 'aviso_de_cobro' | 'pago_fallido';

/** Decisión de la persona. Nace `propuesto`. */
export type EstadoCandidato = 'propuesto' | 'confirmado' | 'rechazado';

/**
 * Si el proveedor se reconoció. `servicio` es null cuando no es `reconocido`:
 * no se inventa un nombre.
 */
export type ServicioResultado = 'reconocido' | 'ambiguo' | 'desconocido';

/**
 * Qué pasó con la orden de un candidato confirmado (S3-FE-15). `null` mientras
 * no esté confirmado. `pendiente` quiere decir que la orden quedó en cola y que
 * todavía no hay suscripción ni cobro creados.
 */
export type AplicacionCandidato = 'pendiente' | null;

/**
 * CobroCandidatoSerializer: un cobro detectado en un archivo o un correo.
 * Todo de solo lectura. `importe` llega como texto para no perder exactitud.
 */
export interface CandidatoDetectado {
  id: string;
  importacion: string;
  origen: OrigenCandidato;
  origen_legible: string;
  /** Igual para el mismo hecho leído dos veces: por eso recargar no duplica. */
  identificador_origen: string;
  servicio: string | null;
  servicio_texto: string;
  servicio_resultado: ServicioResultado;
  importe: string;
  moneda: string;
  fecha: string;
  tipo_mensaje: TipoMensajeCandidato;
  tipo_mensaje_legible: string;
  estado: EstadoCandidato;
  estado_legible: string;
  decidido_en: string | null;
  decidido_por: string;
  aplicacion: AplicacionCandidato;
  /** Fila del CSV y texto original, cuando los hay. */
  evidencia: Record<string, unknown>;
  creado_en: string;
}

/** Cuántos pide cada página: se manda siempre, igual que en alertas. */
export const TAMANO_PAGINA_CANDIDATOS = 10;

export interface ConsultaCandidatos {
  /** Sin valor, los dos orígenes. */
  origen?: OrigenCandidato;
  /** Sin valor, todos los estados. */
  estado?: EstadoCandidato;
  /** Solo las filas de una lectura. Un UUID; el servidor lo valida. */
  importacion?: string;
  /** Empieza en 1. */
  pagina?: number;
}

/**
 * GET /api/candidatos/ (S3-FE-14), los de la organización. Una página que no
 * existe responde 404, como cualquier paginador de DRF.
 */
export async function getCandidatos({
  origen,
  estado,
  importacion,
  pagina = 1,
}: ConsultaCandidatos = {}): Promise<Paginado<CandidatoDetectado>> {
  const consulta = new URLSearchParams({ page: String(pagina), page_size: String(TAMANO_PAGINA_CANDIDATOS) });
  if (origen) consulta.set('origen', origen);
  if (estado) consulta.set('estado', estado);
  if (importacion) consulta.set('importacion', importacion);
  return await pedir(`/candidatos/?${consulta.toString()}`);
}

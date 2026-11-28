import { ErrorDeApi, pedir, type Paginado } from './cliente';

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
 * Qué se sabe desde Conectores de la orden de un candidato confirmado (S3-FE-15,
 * RF-14). `null` mientras no esté confirmado. `por_enviar`: la orden sigue en
 * cola. `enviada`: salió hacia Suscripciones, que es donde se registran la
 * suscripción y el cobro; Conectores no puede ver si ya quedaron, así que
 * `enviada` no lo afirma.
 */
export type AplicacionCandidato = 'por_enviar' | 'enviada' | null;

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

/**
 * Por qué el servidor no confirma un cobro (409). Los códigos son estables
 * (S3-FE-15):
 * - `candidato_rechazado`: ya se descartó; desde aquí no se puede confirmar.
 * - `servicio_sin_resolver`: no se reconoció el proveedor.
 * - `tipo_sin_regla`: no hay regla para el tipo de mensaje.
 * - `importe_fuera_de_rango`: el monto no cabe como cobro (RF-14); sigue propuesto.
 */
const CODIGOS_DE_CONFIRMACION_RECHAZADA = [
  'candidato_rechazado',
  'servicio_sin_resolver',
  'tipo_sin_regla',
  'importe_fuera_de_rango',
] as const;
export type CodigoConfirmacionRechazada = (typeof CODIGOS_DE_CONFIRMACION_RECHAZADA)[number];

/**
 * Por qué el servidor no rechaza un cobro (409, S3-FE-16). Solo hay uno: un cobro
 * confirmado ya creó suscripciones y cobros, y deshacerlos no es rechazarlo.
 */
const CODIGOS_DE_RECHAZO_NO_PERMITIDO = ['candidato_ya_confirmado'] as const;
export type CodigoRechazoNoPermitido = (typeof CODIGOS_DE_RECHAZO_NO_PERMITIDO)[number];

/**
 * POST /api/candidatos/<id>/confirmar/ (S3-FE-15). Responde 200 con el candidato
 * `confirmado`. Es idempotente: repetirlo devuelve el mismo candidato y no
 * agrega otra orden. Confirmar no crea la suscripción ni el cobro en el momento:
 * deja la orden en cola (`aplicacion: 'por_enviar'`) y Suscripciones los registra
 * cuando la recibe.
 */
export async function confirmarCandidato(id: string): Promise<CandidatoDetectado> {
  return await pedir(`/candidatos/${encodeURIComponent(id)}/confirmar/`, { method: 'POST' });
}

/**
 * POST /api/candidatos/<id>/rechazar/ (S3-FE-16). Responde 200 con el candidato
 * `rechazado`. Es idempotente: repetirlo devuelve la misma decisión y no toca
 * suscripciones ni cobros.
 */
export async function rechazarCandidato(id: string): Promise<CandidatoDetectado> {
  return await pedir(`/candidatos/${encodeURIComponent(id)}/rechazar/`, { method: 'POST' });
}

/**
 * El código de un 409 de confirmar, o null si el error no es uno de ellos. El
 * servidor manda `{ codigo, detail }`; `pedir` deja el `detail` como mensaje y
 * el `codigo` entre los campos.
 */
export function codigoDeConfirmacionRechazada(error: unknown): CodigoConfirmacionRechazada | null {
  return codigoDeUnConflicto(error, CODIGOS_DE_CONFIRMACION_RECHAZADA);
}

/** El código de un 409 de rechazar, o null. La misma forma que el de confirmar. */
export function codigoDeRechazoNoPermitido(error: unknown): CodigoRechazoNoPermitido | null {
  return codigoDeUnConflicto(error, CODIGOS_DE_RECHAZO_NO_PERMITIDO);
}

/** El `codigo` de un 409 si es uno de los conocidos; cualquier otra cosa da null. */
function codigoDeUnConflicto<T extends string>(error: unknown, conocidos: readonly T[]): T | null {
  if (!(error instanceof ErrorDeApi) || error.status !== 409) return null;
  const codigo = error.campos?.codigo?.[0];
  return conocidos.find((conocido) => conocido === codigo) ?? null;
}

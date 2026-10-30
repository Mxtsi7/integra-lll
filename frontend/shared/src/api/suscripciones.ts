import type { EstadoSuscripcion, Suscripcion } from '../tipos';
import { pedir, type Paginado } from './cliente';
import { SUSCRIPCIONES_DE_EJEMPLO } from './ejemplo';

/**
 * El servicio `subscriptions` ya expone /api/suscripciones/, asi que las
 * pantallas consumen datos reales. Se deja la bandera para poder desarrollar
 * sin backend arriba: en true, ninguna pantalla cambia de forma.
 */
export const USAR_DATOS_DE_EJEMPLO = false;

/**
 * La suscripcion tal como viaja por la API, que no es igual al tipo del
 * dominio:
 *
 * - `monto` llega como texto ("5990.00"). Django serializa los DecimalField
 *   asi para no perder precision, pero el dominio lo declara `number` y lo
 *   suma. Sin convertirlo, `0 + "5990.00"` concatena en vez de sumar y el
 *   gasto proyectado del panel termina en $NaN.
 * - `fin_prueba` puede llegar como `null`; el dominio lo declara opcional,
 *   o sea `undefined`.
 * - `horas_uso_mes` también es un Decimal: desde VI-10 llega siempre como
 *   texto ("0.00", "0.50"), calculado con los usos del mes actual. Sin
 *   convertirlo, "0.00" es un texto no vacío y la pantalla lo trataba como
 *   uso registrado ("0.00 h" en vez de "Sin registrar").
 *
 * La traduccion vive aca, en el borde con la API, para que ninguna pantalla
 * tenga que saber estas diferencias.
 */
type SuscripcionDeApi = Omit<Suscripcion, 'monto' | 'fin_prueba' | 'horas_uso_mes'> & {
  monto: string | number;
  fin_prueba?: string | null;
  horas_uso_mes?: string | number | null;
};

function desdeLaApi(s: SuscripcionDeApi): Suscripcion {
  return {
    ...s,
    monto: Number(s.monto),
    fin_prueba: s.fin_prueba ?? undefined,
    horas_uso_mes: s.horas_uso_mes == null ? undefined : Number(s.horas_uso_mes),
  };
}

/**
 * Tope de paginas a recorrer. Con el PAGE_SIZE actual del backend son miles de
 * suscripciones: mucho mas de lo que un hogar puede tener. Existe solo para que
 * un `next` mal formado no deje el navegador girando para siempre.
 */
const MAX_PAGINAS = 20;

/**
 * Los órdenes que acepta GET /suscripciones/ (VI-02). Es una lista cerrada:
 * el backend responde 400 a cualquier otro campo, y acá ni se arma la
 * consulta (CH-12). El '-' es descendente; el backend desempata por id, así
 * que el orden es el mismo en todas las páginas.
 */
export const ORDENES_SUSCRIPCIONES = [
  'fecha_proximo_cobro',
  '-fecha_proximo_cobro',
  'nombre',
  '-nombre',
  'monto',
  '-monto',
] as const;

export type OrdenSuscripciones = (typeof ORDENES_SUSCRIPCIONES)[number];

/** true si `valor` está en la lista de órdenes permitidos. */
export function esOrdenSuscripciones(valor: string): valor is OrdenSuscripciones {
  return (ORDENES_SUSCRIPCIONES as readonly string[]).includes(valor);
}

/**
 * Filtros y orden del listado (CH-11, CH-12). Viajan a la API, que filtra y
 * ordena ANTES de paginar: el resultado sale bien en todas las páginas, no
 * solo en la primera.
 */
export interface ConsultaSuscripciones {
  /** Solo las que están en este estado. */
  estado?: EstadoSuscripcion;
  /** Solo las que tienen su próximo cobro ese día (YYYY-MM-DD). */
  fecha_cobro?: string;
  orden?: OrdenSuscripciones;
}

/**
 * Arma el query string de una página. URLSearchParams codifica cada valor,
 * así que un filtro no puede colar otro parámetro (p. ej. "&page_size=").
 */
function parametrosDePagina(consulta: ConsultaSuscripciones, pagina: number): string {
  const parametros = new URLSearchParams({ page: String(pagina) });
  if (consulta.estado) parametros.set('estado', consulta.estado);
  if (consulta.fecha_cobro) parametros.set('fecha_cobro', consulta.fecha_cobro);
  if (consulta.orden) parametros.set('orden', consulta.orden);
  return parametros.toString();
}

/**
 * Todas las suscripciones de la organización (todas las páginas). Con
 * `consulta`, solo las que cumplen los filtros y en el orden pedido.
 *
 * Lanza RangeError, sin llamar a la API, si `orden` no está en
 * ORDENES_SUSCRIPCIONES (p. ej. un valor que llegó por la URL).
 */
export async function getSuscripciones(consulta: ConsultaSuscripciones = {}): Promise<Suscripcion[]> {
  if (consulta.orden !== undefined && !esOrdenSuscripciones(consulta.orden)) {
    throw new RangeError(`Orden de suscripciones no permitido: ${String(consulta.orden)}`);
  }
  if (USAR_DATOS_DE_EJEMPLO) return SUSCRIPCIONES_DE_EJEMPLO;

  const todas: SuscripcionDeApi[] = [];

  // Se arma la URL de cada pagina en vez de seguir el `next` que manda la API.
  // Ese `next` viene con el host interno del servicio
  // (http://subscriptions:8002/...), que el navegador no puede alcanzar: lo
  // construye Django desde la peticion que le llego del gateway, no desde la
  // que hizo el navegador. Solo se usa para saber si queda otra pagina.
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
    const respuesta = await pedir<Paginado<SuscripcionDeApi>>(
      `/suscripciones/?${parametrosDePagina(consulta, pagina)}`,
    );
    todas.push(...respuesta.results);
    if (!respuesta.next) break;
  }

  return todas.map(desdeLaApi);
}

/**
 * Datos que el dominio manda al crear o reemplazar una suscripcion. Es el
 * tipo del dominio sin `id` (lo asigna el backend) y sin los campos que solo
 * tienen sentido como respuesta de la API.
 *
 * `monto` va como `number`: a diferencia de la lectura, Django acepta un
 * numero en el body de escritura para un DecimalField sin problema, asi que
 * no hace falta traducirlo antes de mandarlo (solo se traduce lo que
 * *llega*, no lo que se envia).
 */
export type SuscripcionPayload = Omit<Suscripcion, 'id'>;

/** Igual que SuscripcionPayload pero parcial, para PATCH (ej. solo el estado). */
export type SuscripcionPayloadParcial = Partial<SuscripcionPayload>;

/** POST /suscripciones/ -> 201 Created. Crea una suscripcion para la organizacion. */
export async function crearSuscripcion(
  datos: SuscripcionPayload,
): Promise<Suscripcion> {
  const creada = await pedir<SuscripcionDeApi>('/suscripciones/', {
    method: 'POST',
    body: datos,
  });
  return desdeLaApi(creada);
}

/** GET /suscripciones/<id>/ -> 200 OK / 404. Detalle de una suscripcion propia. */
export async function getSuscripcion(id: string): Promise<Suscripcion> {
  const suscripcion = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/`);
  return desdeLaApi(suscripcion);
}

/** PUT /suscripciones/<id>/ -> 200 OK / 404. Reemplaza por completo una suscripcion propia. */
export async function reemplazarSuscripcion(
  id: string,
  datos: SuscripcionPayload,
): Promise<Suscripcion> {
  const actualizada = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/`, {
    method: 'PUT',
    body: datos,
  });
  return desdeLaApi(actualizada);
}

/** PATCH /suscripciones/<id>/ -> 200 OK / 404. Actualiza parcialmente (ej. estado). */
export async function actualizarSuscripcion(
  id: string,
  datos: SuscripcionPayloadParcial,
): Promise<Suscripcion> {
  const actualizada = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/`, {
    method: 'PATCH',
    body: datos,
  });
  return desdeLaApi(actualizada);
}

/** DELETE /suscripciones/<id>/ -> 204 No Content / 404. Elimina una suscripcion propia. */
export async function eliminarSuscripcion(id: string): Promise<void> {
  await pedir<void>(`/suscripciones/${id}/`, { method: 'DELETE' });
}

/**
 * POST /suscripciones/<id>/cancelar/ -> 200 OK / 400 / 403 / 404 (VI-03, CH-10).
 *
 * Pasa la suscripción a `cancelado` SIN borrarla: conserva sus cobros y su
 * historial de uso, y deja de proyectar cobros futuros. Es idempotente:
 * cancelar una ya cancelada responde 200 sin repetir nada. No reemplaza a
 * eliminarSuscripcion() (DELETE), que la saca de la lista.
 */
export async function cancelarSuscripcion(id: string): Promise<Suscripcion> {
  const cancelada = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/cancelar/`, {
    method: 'POST',
  });
  return desdeLaApi(cancelada);
}

/**
 * POST /suscripciones/<id>/reactivar/ -> 200 OK / 400 / 403 / 404 (VI-09).
 *
 * Vuelve a `activo` una suscripción `cancelado`, a pedido del usuario. No
 * restaura el estado que tenía antes (prueba, sin uso) ni cambia su fecha
 * de cobro: lo que vale es la suscripción que devuelve el backend. Es
 * idempotente: reactivar una ya activa responde 200. Desde otro estado
 * responde 400. Es la contraparte de cancelarSuscripcion(); un PATCH a
 * estado="activo" no sirve, el backend lo rechaza.
 */
export async function reactivarSuscripcion(id: string): Promise<Suscripcion> {
  const reactivada = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/reactivar/`, {
    method: 'POST',
  });
  return desdeLaApi(reactivada);
}

/** Minutos de uso que se registran manualmente (CU-23 / RF-15 / RF-16). */
export interface UsoPayload {
  minutos: number;
  /**
   * Fecha calendario del uso (YYYY-MM-DD). Opcional: sin fecha el backend usa
   * la fecha local de hoy. No puede ser futura (RegistrarUsoSerializer.validate_fecha).
   */
  fecha?: string;
}

/** Un registro del historial de uso (RegistroUsoSerializer). */
export interface RegistroUso {
  /** ISO (YYYY-MM-DD). */
  fecha: string;
  minutos: number;
}

/**
 * GET /suscripciones/<id>/uso/ -> 200 OK / 404 (CH-15).
 * Historial de uso de UNA suscripción, del más reciente al más antiguo (así
 * lo ordena el backend). No está paginado.
 */
export async function getUsos(id: string): Promise<RegistroUso[]> {
  return pedir<RegistroUso[]>(`/suscripciones/${id}/uso/`);
}

/**
 * POST /suscripciones/<id>/uso/ -> 200 OK / 400 / 404.
 * Registra minutos de uso manual (CU-23 / RF-04 / RF-15 / RF-16).
 * Opcionalmente acepta la fecha calendario del uso; no puede ser futura.
 */
export async function registrarUso(
  id: string,
  datos: UsoPayload,
): Promise<Suscripcion> {
  // Una fecha vacía no se manda: RegistrarUsoSerializer rechaza "" pero
  // acepta la propiedad ausente (usa hoy). Así ningún llamador puede mandar
  // un body inválido por un campo de fecha borrado.
  const cuerpo: UsoPayload = datos.fecha ? datos : { minutos: datos.minutos };
  const actualizada = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/uso/`, {
    method: 'POST',
    body: cuerpo,
  });
  return desdeLaApi(actualizada);
}

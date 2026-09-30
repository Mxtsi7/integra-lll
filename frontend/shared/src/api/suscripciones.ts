import type { Suscripcion } from '../tipos';
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
 * - `fin_prueba` y `horas_uso_mes` llegan como `null`; el dominio los declara
 *   opcionales, o sea `undefined`.
 *
 * La traduccion vive aca, en el borde con la API, para que ninguna pantalla
 * tenga que saber estas diferencias.
 */
type SuscripcionDeApi = Omit<Suscripcion, 'monto' | 'fin_prueba' | 'horas_uso_mes'> & {
  monto: string | number;
  fin_prueba?: string | null;
  horas_uso_mes?: number | null;
};
 
function desdeLaApi(s: SuscripcionDeApi): Suscripcion {
  return {
    ...s,
    monto: Number(s.monto),
    fin_prueba: s.fin_prueba ?? undefined,
    horas_uso_mes: s.horas_uso_mes ?? undefined,
  };
}
 
/**
 * Tope de paginas a recorrer. Con el PAGE_SIZE actual del backend son miles de
 * suscripciones: mucho mas de lo que un hogar puede tener. Existe solo para que
 * un `next` mal formado no deje el navegador girando para siempre.
 */
const MAX_PAGINAS = 20;
 
export async function getSuscripciones(): Promise<Suscripcion[]> {
  if (USAR_DATOS_DE_EJEMPLO) return SUSCRIPCIONES_DE_EJEMPLO;
 
  const todas: SuscripcionDeApi[] = [];
 
  // Se arma la URL de cada pagina en vez de seguir el `next` que manda la API.
  // Ese `next` viene con el host interno del servicio
  // (http://subscriptions:8002/...), que el navegador no puede alcanzar: lo
  // construye Django desde la peticion que le llego del gateway, no desde la
  // que hizo el navegador. Solo se usa para saber si queda otra pagina.
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
    const respuesta = await pedir<Paginado<SuscripcionDeApi>>(
      `/suscripciones/?page=${pagina}`,
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
 
/** Minutos de uso que se registran manualmente (CU-23 / RF-15 / RF-16). */
export interface UsoPayload {
  minutos: number;
}
 
/**
 * POST /suscripciones/<id>/uso/ -> 200 OK / 400 / 404.
 * Registra minutos de uso manual (CU-23 / RF-15 / RF-16).
 */
export async function registrarUso(
  id: string,
  datos: UsoPayload,
): Promise<Suscripcion> {
  const actualizada = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/uso/`, {
    method: 'POST',
    body: datos,
  });
  return desdeLaApi(actualizada);
}

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

import type { Suscripcion } from '../tipos';
import { pedir, type Paginado } from './cliente';
import { SUSCRIPCIONES_DE_EJEMPLO } from './ejemplo';

/**
 * Mientras el servicio `subscriptions` no exponga /api/suscripciones/, las
 * pantallas se desarrollan contra datos de ejemplo. Cuando exista el
 * endpoint, esto pasa a false y ninguna pantalla cambia.
 */
export const USAR_DATOS_DE_EJEMPLO = true;

export async function getSuscripciones(): Promise<Suscripcion[]> {
  if (USAR_DATOS_DE_EJEMPLO) return SUSCRIPCIONES_DE_EJEMPLO;
  const pagina = await pedir<Paginado<Suscripcion>>('/suscripciones/');
  return pagina.results;
}

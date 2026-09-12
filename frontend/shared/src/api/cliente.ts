/**
 * Cliente HTTP mínimo. Toda llamada a la API pasa por acá, así que cuando
 * exista el token del gateway (ADR-004) se agrega en un solo lugar.
 *
 * No lee variables de entorno: la web las tiene en import.meta.env y móvil en
 * la configuración de Expo. Cada cliente llama a configurarApi() al arrancar.
 */

let urlBase = '';

export function configurarApi(opciones: { urlBase: string }): void {
  urlBase = opciones.urlBase.replace(/\/+$/, '');
}

export async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  if (!urlBase) {
    throw new Error('API sin configurar: llamar configurarApi({ urlBase }) al iniciar la app');
  }
  const respuesta = await fetch(`${urlBase}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!respuesta.ok) {
    throw new Error(`${init.method ?? 'GET'} ${ruta} respondió ${respuesta.status}`);
  }
  return (await respuesta.json()) as T;
}

/** Forma en que DRF pagina las listas (PAGE_SIZE en settings.py de cada servicio). */
export interface Paginado<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

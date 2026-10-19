// AN-15 · Reglas para iniciar la conexión de correo (Gmail / Outlook).
// Sin llamadas al backend: la ruta del endpoint la define FE-03 (Felipe).
// Agregar en shared/src/index.ts:  export * from './api/conectores';

export type ProveedorCorreo = 'gmail' | 'outlook';

/** Dominios permitidos para la pantalla de autorización de cada proveedor. */
export const DOMINIOS_AUTORIZACION: Record<ProveedorCorreo, readonly string[]> = {
  gmail: ['accounts.google.com'],
  outlook: ['login.microsoftonline.com', 'login.live.com'],
};

/**
 * ¿La URL que devolvió el backend es de verdad la pantalla de autorización del proveedor pedido?
 * Exige https, dominio exacto de la lista y sin usuario/contraseña embebidos.
 * Cualquier otra cosa (otro dominio, http, URL mal formada) → false: NO se redirige.
 */
export function esUrlAutorizacionValida(proveedor: ProveedorCorreo, url: unknown): boolean {
  if (typeof url !== 'string') return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && DOMINIOS_AUTORIZACION[proveedor].includes(u.hostname);
}

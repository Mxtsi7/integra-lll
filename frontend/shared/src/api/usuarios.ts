import type { Usuario } from '../tipos';
import { pedir } from './cliente';

/**
 * Mientras el servicio `auth` no exponga /api/usuarios/me/, la pantalla de
 * Perfil se desarrolla contra datos de ejemplo. Mismo patrón que
 * USAR_DATOS_DE_EJEMPLO en suscripciones.ts: cuando exista el endpoint,
 * esto pasa a false y la pantalla no cambia.
 */
export const USAR_USUARIO_DE_EJEMPLO = true;

const USUARIO_DE_EJEMPLO: Usuario = {
  id: 'usr-1',
  nombre: 'Usuario de prueba',
  correo: 'usuario@correo.cl',
  rol: 'titular',
  organizacion_id: 'org-1',
  plan: 'gratuito',
};

/** El usuario autenticado actual (según el JWT que ya trae el token de sesión). */
export async function getUsuarioActual(): Promise<Usuario> {
  if (USAR_USUARIO_DE_EJEMPLO) return USUARIO_DE_EJEMPLO;
  return pedir<Usuario>('/usuarios/me/');
}

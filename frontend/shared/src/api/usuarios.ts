import type { Usuario } from '../tipos';
import type { AuthSchemas } from '../contratos/auth.generated';
import { pedir } from './cliente';

export const USAR_USUARIO_DE_EJEMPLO = false;

const USUARIO_DE_EJEMPLO: Usuario = {
  id: 'usr-1',
  nombre: 'Usuario de prueba',
  correo: 'usuario@correo.cl',
  rol: 'titular',
  organizacion_id: 'org-1',
  plan: 'gratuito',
};

// Rutas del servicio auth (pasan por el gateway con el JWT). Viven acá, una
// sola vez, para que ninguna pantalla arme una URL a mano.
const RUTA_USUARIO_ACTUAL = '/usuarios/me/';
const RUTA_CAMBIO_CONTRASENA = '/auth/change-password/';

/** Conserva el modelo de presentación previo; el contrato HTTP conserva sus tipos reales. */
function presentarUsuario(datos: AuthSchemas['UsuarioActual']): Usuario {
  return { ...datos, id: String(datos.id), rol: datos.rol ?? '', organizacion_id: datos.organizacion_id ?? '' };
}

/** El usuario autenticado actual (según el JWT que ya trae el token de sesión). */
export async function getUsuarioActual(): Promise<Usuario> {
  if (USAR_USUARIO_DE_EJEMPLO) return USUARIO_DE_EJEMPLO;
  return presentarUsuario(await pedir<AuthSchemas['UsuarioActual']>(RUTA_USUARIO_ACTUAL));
}

/**
 * PATCH /usuarios/me/ (MX-06, para CH-08). El backend solo acepta la clave
 * `nombre` (CambioPerfilSerializer rechaza cualquier otra) y devuelve el
 * usuario ya guardado: ese es el dato confirmado que muestra la pantalla.
 *
 * Errores (ErrorDeApi): 400 con `campos.nombre` si el nombre no sirve
 * (vacío o de más de 150 caracteres); 403/404 si la sesión ya no vale.
 */
export async function actualizarNombre(nombre: string): Promise<Usuario> {
  // DRF recorta los espacios del CharField; se recortan acá también para
  // que lo enviado sea exactamente lo que quedará guardado.
  return presentarUsuario(await pedir<AuthSchemas['UsuarioActual']>(RUTA_USUARIO_ACTUAL, { method: 'PATCH', body: { nombre: nombre.trim() } }));
}

/** Lo que espera CambioClaveSerializer (MX-05), con sus mismos nombres. */
export type CambioContrasenaPayload = AuthSchemas['CambioClaveRequest'];

/**
 * POST /auth/change-password/ (MX-05, para CH-29). Requiere sesión: pasa por
 * `pedir()`, que manda el JWT (no es una ruta pública del gateway).
 *
 * Si responde 200, el backend ya cambió la contraseña y con eso invalidó
 * TODAS las sesiones abiertas, también la de este navegador: quien llama
 * tiene que cerrar la sesión local y mandar a iniciar sesión de nuevo.
 *
 * Errores (ErrorDeApi): 400 con `campos.password_actual` (no es la actual),
 * `campos.password` (no cumple la política) o `campos.password_confirmacion`
 * (no coinciden); 503 si no se pudo completar (la contraseña NO cambió).
 * Las contraseñas no se recortan: el backend tampoco (trim_whitespace=False).
 */
export async function cambiarContrasena(datos: CambioContrasenaPayload): Promise<void> {
  await pedir<{ detail: string }>(RUTA_CAMBIO_CONTRASENA, { method: 'POST', body: datos });
}

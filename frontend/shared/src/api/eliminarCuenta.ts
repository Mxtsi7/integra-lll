import { AuthError } from '../auth';
import { ErrorDeApi, pedir } from './cliente';


/**
 * Habilita "Eliminar cuenta" en la WEB (Perfil y Ajustes, S3-AN-03). Es true porque MX-07 ya
 * está en main (DELETE /usuarios/me/, limpieza duradera por el worker `auth-eliminaciones` y
 * endpoints internos en suscripciones, conectores, analítica y notificaciones). Requiere
 * ELIMINACION_INTERNA_SECRET y ELIMINACION_DESTINOS en el despliegue; si faltan, el backend
 * responde 503 y la cuenta sigue activa. Para apagarlo en una emergencia: false.
 */
export const ELIMINAR_CUENTA_WEB_DISPONIBLE = true;

/**
 * Habilita la pantalla de Eliminar cuenta en MÓVIL (AN-19). Sigue en false a propósito: su
 * pantalla llama cerrarSesion() al terminar sin comprobar que la sesión (ni la pantalla)
 * sigan siendo las que pidieron el borrado, y una respuesta tardía podría cerrar la sesión de
 * otra cuenta que entró después. Se enciende cuando AN-19 tenga esa protección.
 */
export const ELIMINAR_CUENTA_DISPONIBLE = false;

/** Cuerpo de DELETE /usuarios/me/ (MX-07). */
export interface DatosEliminacion {
  /** Contraseña actual: reautentica al usuario. */
  password: string;
  confirmacion: 'ELIMINAR';
  /** Solo el último titular activo: confirma que también se elimina la organización. */
  confirmacion_organizacion?: 'ELIMINAR';
}

export type ResultadoEliminacion =
  /** 204: la cuenta se eliminó y las sesiones se revocaron. */
  | { estado: 'eliminada' }
  /** 202: la limpieza de la organización sigue en curso; todavía no está completada. */
  | { estado: 'pendiente'; operacionId?: string };

/**
 * DELETE /usuarios/me/ (MX-07). Errores (AuthError, por status):
 * - 403 contraseña incorrecta o sin contexto · 400 cuerpo inválido
 * - 409 el último titular debe enviar `confirmacion_organizacion` (no cambió nada)
 * - 503 no se pudo completar; no se borró nada y se puede reintentar
 */
export async function eliminarCuenta(datos: DatosEliminacion): Promise<ResultadoEliminacion> {
  try {
    const respuesta = await pedir<{ estado?: string; operacion_id?: string } | undefined>('/usuarios/me/', {
      method: 'DELETE',
      body: datos,
    });
    if (respuesta === undefined) return { estado: 'eliminada' };
    if (respuesta.estado === 'pendiente') return { estado: 'pendiente', operacionId: respuesta.operacion_id };
    // Cualquier otra cosa no es un resultado que el backend documente: no se asume éxito.
    throw new AuthError('El servicio respondió en un formato inesperado.', 502);
  } catch (err: unknown) {
    if (err instanceof ErrorDeApi) throw new AuthError(err.message, err.status);
    throw err;
  }
}

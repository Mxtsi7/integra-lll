import { AuthError } from '@ojoalgasto/shared';

/** La palabra que la persona debe escribir para confirmar. */
export const PALABRA_CONFIRMACION = 'ELIMINAR' as const;

/** Qué le pasó a la eliminación y dónde mostrar el mensaje. */
export interface ErrorDeEliminacion {
  /** "contrasena" va junto al campo; "general" va arriba del botón. */
  lugar: 'contrasena' | 'general';
  mensaje: string;
  /** El último titular debe confirmar además que se elimina la organización. */
  pideConfirmarOrganizacion?: boolean;
}

/**
 * Traduce el error del backend (MX-07) a un mensaje para la persona.
 * Ningún error cierra la sesión ni da la cuenta por eliminada.
 */
export function describirErrorDeEliminacion(error: unknown): ErrorDeEliminacion {
  if (error instanceof AuthError) {
    if (error.status === 409) {
      return {
        lugar: 'general',
        pideConfirmarOrganizacion: true,
        mensaje:
          'Eres la última persona titular de tu organización. Para continuar, confirma que también se eliminará la organización.',
      };
    }
    if (error.status === 403) {
      return { lugar: 'contrasena', mensaje: 'No pudimos confirmar tu identidad. Revisa tu contraseña.' };
    }
    if (error.status === 400) {
      return { lugar: 'general', mensaje: 'Revisa los datos e inténtalo de nuevo.' };
    }
    if (error.status === 503) {
      return { lugar: 'general', mensaje: 'No pudimos completar la eliminación. Tu cuenta sigue activa; inténtalo de nuevo en unos minutos.' };
    }
  }
  if (error instanceof TypeError) {
    return { lugar: 'general', mensaje: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.' };
  }
  return { lugar: 'general', mensaje: 'No pudimos eliminar tu cuenta. Inténtalo de nuevo.' };
}

export const MENSAJE_CUENTA_ELIMINADA = 'Tu cuenta fue eliminada y cerramos tu sesión.';
export const MENSAJE_ELIMINACION_PENDIENTE =
  'Cerramos tu sesión y estamos eliminando tu organización. Este proceso puede tardar y todavía no termina.';

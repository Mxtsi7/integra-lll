import { AuthError } from '@ojoalgasto/shared';

/** Lo que muestra la pantalla de verificación. */
export type EstadoVerificacion =
  | { tipo: 'verificando' }
  | { tipo: 'verificado' }
  | { tipo: 'vencido' }
  | { tipo: 'usado' }
  | { tipo: 'invalido' }
  | { tipo: 'correo_no_disponible' }
  /** No se pudo confirmar, pero el enlace sigue siendo válido: se puede reintentar. */
  | { tipo: 'error'; mensaje: string };

// `codigo` que devuelve el backend (contrato MX-28) → pantalla.
const ESTADO_POR_CODIGO: Record<string, EstadoVerificacion['tipo']> = {
  token_expirado: 'vencido',
  token_usado: 'usado',
  token_invalido: 'invalido',
  correo_no_disponible: 'correo_no_disponible',
};

export const MENSAJE_SIN_RED = 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
export const MENSAJE_ERROR_VERIFICACION = 'No pudimos verificar tu correo. Inténtalo de nuevo.';

/** Traduce el fallo de la confirmación a un estado de pantalla. Un enlace inválido nunca activa nada. */
export function estadoDesdeError(error: unknown): EstadoVerificacion {
  if (error instanceof AuthError && error.codigo && error.codigo in ESTADO_POR_CODIGO) {
    return { tipo: ESTADO_POR_CODIGO[error.codigo] } as EstadoVerificacion;
  }
  if (error instanceof TypeError) return { tipo: 'error', mensaje: MENSAJE_SIN_RED };
  // 503 u otro: el enlace sigue siendo válido y se puede reintentar.
  return { tipo: 'error', mensaje: error instanceof AuthError && error.message ? error.message : MENSAJE_ERROR_VERIFICACION };
}

/** Mensaje para quien pidió reenviar el enlace y falló. */
export function mensajeDeErrorDeReenvio(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.codigo === 'limite_reenvio' || error.status === 429) {
      return 'Pediste demasiados enlaces. Espera un minuto antes de intentar de nuevo (máximo 5 por hora).';
    }
    if (error.status === 401) return 'Tu sesión expiró. Inicia sesión e inténtalo de nuevo.';
  }
  if (error instanceof TypeError) return MENSAJE_SIN_RED;
  return 'No pudimos enviar el enlace. Inténtalo de nuevo.';
}

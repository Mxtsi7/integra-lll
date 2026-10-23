// AN-13 · Verificación de correo desde la web (contrato MX-28).
// - Confirmar (público) vive en auth.ts: confirmarCorreo(token), junto a restablecerContrasena.
// - Reenviar exige sesión: POST /auth/email-verification/request/ sin cuerpo verifica el correo actual.
import { AuthError, obtenerAccessToken } from '../auth';
import { ErrorDeApi, pedir } from './cliente';

/**
 * Pide un enlace de verificación nuevo para el correo actual. El backend invalida el anterior.
 * Errores (AuthError): 429 codigo=limite_reenvio (60 s entre envíos, máx. 5 por hora),
 * 401 sesión vencida, 503 no se pudo enviar el correo.
 */
export async function reenviarVerificacion(): Promise<void> {
  try {
    await pedir<{ detail: string }>('/auth/email-verification/request/', { method: 'POST', body: {} });
  } catch (err: unknown) {
    if (err instanceof ErrorDeApi) {
      throw new AuthError(err.message, err.status, { codigo: err.status === 429 ? 'limite_reenvio' : undefined });
    }
    throw err;
  }
}

/** ¿Hay una sesión en este navegador? Solo decide si se ofrece "Reenviar" o "Iniciar sesión". */
export function haySesionParaReenvio(): boolean {
  return Boolean(obtenerAccessToken());
}

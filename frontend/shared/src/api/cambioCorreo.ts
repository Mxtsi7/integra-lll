// S3-AN-02 · Cambiar el correo desde Perfil (contratos MX-06 y MX-28).
// Pedir el cambio NO cambia el correo: el backend manda un enlace al correo
// NUEVO y deja el actual activo hasta que se confirma (confirmarCorreo, en auth.ts).
import { AuthError } from '../auth';
import { ErrorDeApi, pedir } from './cliente';

/** `code` que manda el backend al pedir el cambio. */
export type CodigoErrorCambioCorreo =
  /** 400: la contraseña actual no coincide. */
  | 'identidad_invalida'
  /** 400: ese correo ya lo usa otra cuenta. */
  | 'correo_no_disponible'
  /** 429: máximo 5 envíos por hora y uno cada 60 segundos. */
  | 'limite_reenvio';

/**
 * POST /auth/email-verification/request/ con el correo nuevo y la contraseña
 * actual. Errores (AuthError, con `codigo` cuando el backend lo manda):
 * - 400 identidad_invalida · 400 correo_no_disponible · 429 limite_reenvio
 * - 401 sesión vencida · 503 no se pudo enviar el correo (la solicitud se revierte)
 */
export async function solicitarCambioCorreo(datos: { correo: string; password: string }): Promise<void> {
  try {
    await pedir<{ detail: string }>('/auth/email-verification/request/', {
      method: 'POST',
      body: { email: datos.correo.trim(), password: datos.password },
    });
  } catch (err: unknown) {
    if (err instanceof ErrorDeApi) {
      const codigo = err.codigo ?? (err.status === 429 ? 'limite_reenvio' : undefined);
      throw new AuthError(err.message, err.status, { codigo, campos: err.campos });
    }
    throw err;
  }
}

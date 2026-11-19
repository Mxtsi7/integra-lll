import type { CuentaConectada, Importacion } from '@ojoalgasto/shared';

/**
 * Lo que la página sabe de la cuenta de una importación de correo. `listo` con `cuenta: null`
 * quiere decir que la cuenta ya no está en el listado (se desconectó o se borró).
 */
export type EstadoCuentaDeImportacion =
  | { tipo: 'sin-cuenta' }
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'listo'; cuenta: CuentaConectada | null };

/**
 * Códigos de error de una lectura de correo que quieren decir "hay que volver a autorizar la
 * cuenta". `requiere_reautorizacion` y `sin_credenciales` vienen de CuentaNoDisponible; el
 * `permiso_insuficiente` lo manda Gmail y Outlook cuando el proveedor niega un permiso que la
 * autorización no incluye (403 en lector_gmail.py y lector_outlook.py).
 *
 * `credencial_vencida` no está: el backend la renueva sola, y solo pide reconectar si la
 * renovación falla (renovacion.py), y eso ya llega como `requiere_reautorizacion`.
 */
export const CODIGOS_QUE_PIDEN_RECONEXION: readonly string[] = [
  'requiere_reautorizacion',
  'sin_credenciales',
  'permiso_insuficiente',
];

/**
 * ¿Hay que pedirle a la persona que vuelva a autorizar la cuenta de esta importación?
 *
 * Si la cuenta se pudo consultar, manda lo que dice ahora: una importación vieja con un error de
 * autorización ya resuelto no vuelve a avisar. Si no se pudo consultar (o no hay cuenta), se mira
 * el error de la propia importación. Mientras la cuenta carga no se avisa todavía. Un CSV nunca
 * pide reconexión: no tiene cuenta.
 */
export function hayQueReconectar(importacion: Importacion, estadoCuenta: EstadoCuentaDeImportacion): boolean {
  if (importacion.origen !== 'correo') return false;
  if (estadoCuenta.tipo === 'cargando') return false;
  if (estadoCuenta.tipo === 'listo' && estadoCuenta.cuenta !== null) {
    return estadoCuenta.cuenta.necesita_reautorizacion;
  }
  return importacion.errores.some((error) => error.codigo !== undefined && CODIGOS_QUE_PIDEN_RECONEXION.includes(error.codigo));
}

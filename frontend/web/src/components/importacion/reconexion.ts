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
 *
 * Cuando la lectura marca la cuenta (lo hace con `permiso_insuficiente` y con un rechazo del
 * token), el error que queda en la importación es `requiere_reautorizacion`, así que
 * `permiso_insuficiente` normalmente no llega tal cual. Se deja por si llega.
 */
export const CODIGOS_QUE_PIDEN_RECONEXION: readonly string[] = [
  'requiere_reautorizacion',
  'sin_credenciales',
  'permiso_insuficiente',
];

function tieneErrorDeAutorizacion(importacion: Importacion): boolean {
  return importacion.errores.some((error) => error.codigo !== undefined && CODIGOS_QUE_PIDEN_RECONEXION.includes(error.codigo));
}

/**
 * ¿La cuenta cambió después de que terminó la importación? Si cambió, alguien la volvió a autorizar
 * (o una lectura posterior la tocó) y el error de la importación ya no dice cómo está hoy. Si no se
 * sabe cuándo terminó, o una fecha no se entiende, se dice que no cambió: es lo que no esconde un aviso.
 */
function cuentaCambioDespues(importacion: Importacion, cuenta: CuentaConectada): boolean {
  if (importacion.terminada_en === null) return false;
  // Una fecha que no se entiende da NaN, y NaN no es mayor que nada: tampoco cuenta como cambio.
  return Date.parse(cuenta.actualizado_en) > Date.parse(importacion.terminada_en);
}

/**
 * ¿Hay que pedirle a la persona que vuelva a autorizar la cuenta de esta importación?
 *
 * - La cuenta misma lo pide (`necesita_reautorizacion`): sí. El backend la marca en el instante en
 *   que una lectura falla por autorización.
 * - La cuenta figura sana, pero la importación terminó con un error de autorización que la cuenta no
 *   refleja (como `sin_credenciales`): sí, salvo que la cuenta haya cambiado después de que la
 *   importación terminó, porque entonces ya se volvió a autorizar y el error es historia.
 * - No se pudo consultar la cuenta, o no hay cuenta: se mira el error de la propia importación.
 * - Mientras la cuenta carga no se avisa todavía. Un CSV nunca pide reconexión: no tiene cuenta.
 */
export function hayQueReconectar(importacion: Importacion, estadoCuenta: EstadoCuentaDeImportacion): boolean {
  if (importacion.origen !== 'correo') return false;
  if (estadoCuenta.tipo === 'cargando') return false;
  if (estadoCuenta.tipo === 'listo' && estadoCuenta.cuenta !== null) {
    if (estadoCuenta.cuenta.necesita_reautorizacion) return true;
    return tieneErrorDeAutorizacion(importacion) && !cuentaCambioDespues(importacion, estadoCuenta.cuenta);
  }
  return tieneErrorDeAutorizacion(importacion);
}

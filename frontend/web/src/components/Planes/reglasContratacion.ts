import { ErrorDeApi, type ContratacionPlan } from '@ojoalgasto/shared';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';

/** Equipos desde los que se acepta el pago sin https: los mismos que acepta el backend en desarrollo. */
const EQUIPOS_LOCALES = ['localhost', '127.0.0.1', '[::1]'];

/**
 * ¿Es segura la dirección del pago? Solo https (o http en el equipo local) y sin usuario, contraseña
 * ni fragmento. Lo que no pasa esta regla no se abre.
 */
export function esUrlCheckoutValida(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return false;
  }
  if (destino.username || destino.password || destino.hash) return false;
  if (destino.protocol === 'https:') return true;
  return destino.protocol === 'http:' && EQUIPOS_LOCALES.includes(destino.hostname);
}

/**
 * Clave que identifica un intento. Si la misma clave llega dos veces, el servidor devuelve la misma
 * contratación en vez de crear otra: un reintento no duplica el cobro.
 */
export function crearClaveIdempotencia(): string {
  const cripto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cripto?.randomUUID) return cripto.randomUUID();
  // Respaldo para páginas sin contexto seguro (http fuera de localhost): solo hace falta que no se repita.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (letra) => {
    const azar = Math.floor(Math.random() * 16);
    return (letra === 'x' ? azar : (azar & 0x3) | 0x8).toString(16);
  });
}

export const MENSAJE_CHECKOUT_INSEGURO = 'No pudimos abrir el pago de forma segura. Inténtalo de nuevo más tarde.';
export const MENSAJE_PENDIENTE_NO_RECUPERABLE =
  'Ya tienes una contratación pendiente, pero no pudimos encontrarla en este navegador.';
export const MENSAJE_NO_RECUPERO_PENDIENTE =
  'No pudimos recuperar el estado de tu contratación pendiente. Puedes verificarla o cancelarla.';
export const MENSAJE_PLAN_ACTIVANDO =
  'El pago está confirmado, pero tu plan todavía aparece como gratuito. Toca «Verificar estado» en unos segundos.';
export const TEXTO_PRECIO_DEMO = 'Precio de demostración: no se hace ningún cobro real.';

/** Qué le decimos a la persona según cómo terminó la contratación. */
export const TEXTOS_CONTRATACION: Record<ContratacionPlan['estado'], { titulo: string; detalle: string }> = {
  pendiente: {
    titulo: 'Esperando la confirmación del pago',
    detalle: 'Termina el pago y vuelve a esta página. Luego toca «Verificar estado».',
  },
  exitosa: {
    titulo: 'Pago confirmado',
    detalle: 'Tu pago fue aprobado. Tu plan se actualiza cuando el servidor lo confirma.',
  },
  cancelada: {
    titulo: 'Contratación cancelada',
    detalle: 'No se hizo ningún cobro. Puedes volver a intentarlo cuando quieras.',
  },
  fallida: {
    titulo: 'El pago no se pudo completar',
    detalle: 'No se hizo ningún cobro. Puedes intentarlo de nuevo.',
  },
};

/** Traduce el error de contratar a un mensaje. Ningún error deja a la persona como Premium. */
export function mensajeDeErrorDeContratacion(error: unknown): string {
  if (error instanceof ErrorDeApi) {
    if (error.status === 403) return 'Solo la persona titular de la organización puede contratar Premium.';
    if (error.status === 409) return 'Ya tienes una contratación pendiente. Verifica su estado o cancélala.';
    if (error.status === 503) return 'La contratación no está disponible por ahora. Inténtalo más tarde.';
  }
  if (error instanceof TypeError) return MENSAJE_SIN_RED;
  return 'No pudimos completar la operación. Inténtalo de nuevo.';
}

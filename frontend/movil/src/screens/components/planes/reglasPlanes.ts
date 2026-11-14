import {
  ErrorDeApi,
  formatearMonto,
  type ContratacionPlan,
  type FeaturesPlan,
  type PermisosPlan,
} from '@ojoalgasto/shared';

/** Nombre de cada función Premium tal como se le muestra a la persona. */
export const NOMBRES_FEATURES: Record<keyof FeaturesPlan, string> = {
  asistente_financiero: 'Asistente financiero',
  recomendaciones_automaticas: 'Recomendaciones automáticas',
};

export const FEATURES: (keyof FeaturesPlan)[] = ['asistente_financiero', 'recomendaciones_automaticas'];

/**
 * Valida lo que respondió `/usuarios/me/permisos/`. Si no tiene la forma esperada devuelve null
 * y la pantalla lo trata como "no pudimos confirmar tu plan": lo desconocido nunca se toma por permitido.
 */
export function leerPermisos(respuesta: unknown): PermisosPlan | null {
  if (typeof respuesta !== 'object' || respuesta === null) return null;
  const { plan, features } = respuesta as Partial<PermisosPlan>;
  if (plan !== 'free' && plan !== 'premium') return null;
  if (typeof features !== 'object' || features === null) return null;
  return { plan, features };
}

/** ¿Este plan incluye la función? Solo un `true` explícito del servidor cuenta. */
export function incluyeFeature(origen: { features: FeaturesPlan }, feature: keyof FeaturesPlan): boolean {
  return origen.features[feature] === true;
}

/** El precio llega como texto decimal ("4.99"). Solo se convierte para mostrarlo, nunca para contratar. */
export function formatearPrecio(precio: string, moneda: string): string {
  const numero = Number(precio);
  if (!Number.isFinite(numero)) return `${moneda} ${precio}`;
  try {
    return formatearMonto(numero, moneda);
  } catch {
    return `${moneda} ${precio}`; // una moneda desconocida haría fallar a Intl
  }
}

/**
 * ¿Es una dirección segura para abrir el pago? Solo https y sin usuario ni contraseña incrustados
 * (la "@" no puede aparecer antes de la primera "/"). Cualquier otra cosa no se abre.
 */
export function esUrlCheckoutValida(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/[^\s/@?#]+([/?#]\S*)?$/.test(url);
}

/**
 * Clave que identifica un intento de contratación. Si la misma clave llega dos veces, el servidor
 * devuelve la misma contratación en vez de crear otra (así un reintento no duplica el cobro).
 */
export function crearClaveIdempotencia(): string {
  const cripto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cripto?.randomUUID) return cripto.randomUUID();
  // Respaldo para entornos sin crypto: solo hace falta que no se repita, no que sea secreta.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (letra) => {
    const azar = Math.floor(Math.random() * 16);
    return (letra === 'x' ? azar : (azar & 0x3) | 0x8).toString(16);
  });
}

/** Qué le decimos a la persona según cómo terminó la contratación. */
export const TEXTOS_CONTRATACION: Record<ContratacionPlan['estado'], { titulo: string; detalle: string }> = {
  pendiente: {
    titulo: 'Esperando la confirmación del pago',
    detalle: 'Termina el pago en el navegador y vuelve aquí. Luego toca «Verificar estado».',
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

export const MENSAJE_PLAN_ACTIVANDO =
  'El pago está confirmado, pero tu plan todavía aparece como gratuito. Toca «Verificar estado» en unos segundos.';
export const MENSAJE_SIN_RED = 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
export const MENSAJE_CHECKOUT_INSEGURO = 'No pudimos abrir el pago de forma segura. Inténtalo de nuevo más tarde.';
export const MENSAJE_NO_SE_PUDO_ABRIR = 'No pudimos abrir el navegador para completar el pago.';

/** Traduce el error del backend (MX-17) a un mensaje. Ningún error deja a la persona como Premium. */
export function mensajeDeErrorDeContratacion(error: unknown): string {
  if (error instanceof ErrorDeApi) {
    if (error.status === 403) return 'Solo la persona titular de la organización puede contratar Premium.';
    if (error.status === 409) return 'Ya tienes una contratación pendiente. Verifica su estado o cancélala.';
    if (error.status === 503) return 'La contratación no está disponible por ahora. Inténtalo más tarde.';
  }
  if (error instanceof TypeError) return MENSAJE_SIN_RED;
  return 'No pudimos completar la operación. Inténtalo de nuevo.';
}

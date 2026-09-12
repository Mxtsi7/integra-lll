/**
 * Vocabulario del dominio. Los nombres salen del glosario (docs/glosario.md)
 * y los valores de los requisitos: campos de RF-06, categorías de RF-12,
 * estados de RF-13.
 *
 * Los campos van en snake_case porque así los entrega la API (Django) y así
 * están en el modelo de datos. No se traducen a camelCase a propósito: una
 * sola forma de nombrar cada cosa, de la base a la pantalla.
 */

export type EstadoSuscripcion =
  | 'prueba'
  | 'activo'
  | 'por_confirmar'
  | 'cancelado'
  | 'fantasma';

export type Frecuencia = 'mensual' | 'anual';

export type Moneda = 'CLP' | 'USD';

export type Categoria =
  | 'streaming'
  | 'musica'
  | 'productividad'
  | 'nube'
  | 'juegos'
  | 'educacion'
  | 'salud'
  | 'noticias'
  | 'ia'
  | 'otro';

export interface Suscripcion {
  id: string;
  /** El proveedor tal como lo ve el usuario: Netflix, Spotify, el gimnasio. */
  nombre: string;
  /** Valor esperado del próximo cobro. Siempre mayor que cero (RF-06). */
  monto: number;
  moneda: Moneda;
  frecuencia: Frecuencia;
  /** ISO 8601, solo fecha: 2026-10-05 */
  fecha_proximo_cobro: string;
  categoria: Categoria;
  estado: EstadoSuscripcion;
  /** Solo cuando estado === 'prueba'. Alimenta las alertas de 48 h y 24 h (RN-NOT-004). */
  fin_prueba?: string;
  /** Horas de uso registradas en el mes. Es lo que hace posible el costo por hora. */
  horas_uso_mes?: number;
}

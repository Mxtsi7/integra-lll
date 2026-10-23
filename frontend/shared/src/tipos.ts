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
/** Información del usuario autenticado en la plataforma. */
export interface Usuario {
  id: string;
  nombre: string;
  correo: string;
  rol: string;
  organizacion_id: string;
  plan: string;
}

/** Fuente de cobros que se puede conectar (CuentaConectada.Proveedor en connectors). */
export type ProveedorCuenta = 'gmail' | 'outlook' | 'csv';

/** CuentaConectada.Estado en connectors (FE-01). */
export type EstadoCuentaConectada = 'conectada' | 'requiere_reautorizacion' | 'desconectada' | 'error';

/**
 * Una cuenta conectada tal como la entrega CuentaConectadaSerializer
 * (services/connectors). Es el contrato de la página Cuentas (CH-23): el
 * listado que integre AN-17 tiene que devolver esto. Los tokens nunca
 * salen de la API, por eso no están acá.
 */
export interface CuentaConectada {
  id: string;
  proveedor: ProveedorCuenta;
  /** "Gmail", "Outlook"… lo traduce el backend (get_proveedor_display). */
  proveedor_legible: string;
  /** El correo o identificador con que el proveedor conoce la cuenta. */
  cuenta_externa: string;
  estado: EstadoCuentaConectada;
  /** "Conectada", "Requiere reautorización"… lo traduce el backend. */
  estado_legible: string;
  /** Por qué quedó en error o pide reautorizar. Vacío si no aplica. */
  detalle_del_estado: string;
  /** True si no se puede usar sin volver a autorizar (estado o token ilegible). */
  necesita_reautorizacion: boolean;
  /** ISO 8601 con hora, o null. */
  token_expira_en: string | null;
  /** ISO 8601 con hora, o null si nunca se sincronizó bien. */
  ultima_sincronizacion: string | null;
  creado_en: string;
  actualizado_en: string;
}

/** Un cobro ya registrado o uno que se espera según la frecuencia (VI-07). */
export type TipoCobroCalendario = 'confirmado' | 'proyectado';

/**
 * Un cobro del calendario mensual, tal como lo entrega
 * GET /api/suscripciones/calendario-cobros/?mes=YYYY-MM (CalendarioCobroSerializer).
 * Solo `importe` cambia: la API lo manda como texto ("14990.00") y acá es número.
 */
export interface CobroCalendario {
  id: string;
  suscripcion_id: string;
  /** "YYYY-MM-DD": día de negocio, no un instante (no se pasa por UTC). */
  fecha: string;
  /** Nombre del servicio: Netflix, Spotify… */
  servicio: string;
  importe: number;
  moneda: Moneda;
  tipo: TipoCobroCalendario;
}

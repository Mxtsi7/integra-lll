/**
 * Contrato `suscripcion.estado_cambiado.v2` (MX-21 v2).
 *
 * El evento no lleva el ciclo de vida completo de la suscripción: lleva el
 * snapshot del momento y la transición que lo causó. La proyección local
 * necesita ambos para distinguir una transición real de una reentrega.
 */

export type EstadoSuscripcion =
  | 'prueba'
  | 'activo'
  | 'por_confirmar'
  | 'cancelado'
  | 'fantasma';

export type CicloSuscripcion = 'mensual' | 'anual';

export type EventoEstadoSuscripcion =
  | 'fin_prueba'
  | 'fallo_cobro_inicial'
  | 'cancelacion_usuario'
  | 'fallo_cobro'
  | 'cobro_regularizado'
  | 'confirmacion_usuario'
  | 'sin_cobros_60_dias'
  | 'sin_respuesta_30_dias'
  | 'sin_uso_45_dias'
  | 'uso_registrado'
  | 'cobro_nuevo_detectado'
  | 'reactivacion_usuario';

/** Datos del sobre común MX-21 para una suscripción. */
export interface SuscripcionEstadoDatos {
  readonly suscripcion_id: string;
  readonly proveedor_id: string | null;
  readonly nombre: string;
  readonly monto: string;
  readonly moneda: string;
  readonly ciclo: CicloSuscripcion;
  readonly proximo_cobro: string;
  readonly estado: EstadoSuscripcion;
  readonly fin_prueba?: string | null;
  readonly estado_anterior: EstadoSuscripcion;
  readonly evento_estado: EventoEstadoSuscripcion;
}

export interface SuscripcionEstadoEvent {
  readonly evento: 'suscripcion.estado_cambiado';
  readonly version: 2;
  readonly id: string;
  readonly ocurrido_en: string;
  readonly correlation_id: string;
  readonly organizacion_id: string;
  readonly datos: SuscripcionEstadoDatos;
}

/**
 * Hecho validado y normalizado, listo para la transacción del repositorio.
 *
 * `monto` se conserva como texto: el contrato exige dos decimales exactos y
 * convertirlo a `number` antes de PostgreSQL introduciría el redondeo binario
 * que el resumen de gasto justamente evita.
 */
export interface EventoSuscripcionEstadoNormalizado {
  readonly organizacionId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly ocurridoEn: Date;
  readonly suscripcionId: string;
  readonly proveedorId: string | null;
  readonly nombre: string;
  readonly monto: string;
  readonly moneda: string;
  readonly ciclo: CicloSuscripcion;
  readonly proximoCobro: string;
  readonly estado: EstadoSuscripcion;
  readonly finPrueba: string | null;
  readonly estadoAnterior: EstadoSuscripcion;
  readonly eventoEstado: EventoEstadoSuscripcion;
  readonly huella: string;
}

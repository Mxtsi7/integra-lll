/**
 * Contrato canónico de uso de recolectores v1 (S3-VI-01 / S3-MX-01).
 *
 * Fuente de verdad:
 *   docs/contratos/uso-recolectores-v1.md
 *   docs/contratos/uso-recolectores-v1.schema.json
 *   frontend/shared/src/contracts/uso-recolectores.dto.ts
 *
 * Este archivo reproduce el contrato para el servicio de Analytics. No cambia
 * nombres ni semántica: el cuerpo HTTP canónico es `UsageEventPayload` y la
 * suscripción/identidad se resuelven fuera de él. El sobre de RabbitMQ añade
 * el tenant y el destino porque ya fueron autenticados por la recepción.
 */

export type UUID = string;
export type UTCDateTime = string;
export type OrigenRecolector = 'android' | 'navegador';
export type EstadoRecolector = 'activo' | 'pausado' | 'sin_permiso' | 'revocado';
export type EstadoCobertura = 'completa' | 'parcial' | 'sin_medicion';

export interface TramoActividad {
  readonly inicio: UTCDateTime;
  readonly fin: UTCDateTime;
}

/** Cuerpo canónico que envía el recolector. No lleva identidad ni destino. */
export interface UsageEventPayload {
  readonly version: 1;
  readonly event_id: UUID;
  readonly recolector_id: UUID;
  readonly origen: OrigenRecolector;
  readonly inicio: UTCDateTime;
  readonly fin: UTCDateTime;
  readonly duracion_ms: number;
  readonly tramos_actividad: readonly TramoActividad[];
  readonly zona_horaria: string;
  readonly cobertura: EstadoCobertura;
  readonly estado: EstadoRecolector;
}

/**
 * Datos del sobre interno `uso.registrado`.
 *
 * La recepción ya autenticó al usuario y autorizó la suscripción, así que el
 * sobre publica el destino y el tenant junto al cuerpo canónico. El cuerpo
 * HTTP nunca acepta estos campos (ver `validarPayloadUso`).
 */
export interface UsoRegistradoDatos extends UsageEventPayload {
  readonly suscripcion_id: UUID;
  readonly usuario_id?: UUID;
}

/** Sobre común del catálogo de eventos, con el cuerpo canónico en `datos`. */
export interface UsoRegistradoEvent {
  readonly evento: 'uso.registrado';
  readonly version: 1;
  readonly id: UUID;
  readonly ocurrido_en: UTCDateTime;
  readonly correlation_id: UUID;
  readonly organizacion_id: UUID;
  readonly datos: UsoRegistradoDatos;
}

/** Proyección interna derivada; no es una entrada autenticable del cliente. */
export interface CoverageIntervalPayload {
  readonly version: 1;
  readonly coverage_id: UUID;
  readonly event_id: UUID;
  readonly usuario_id: UUID;
  readonly suscripcion_id: UUID;
  readonly recolector_id: UUID;
  readonly origen: OrigenRecolector;
  readonly inicio: UTCDateTime;
  readonly fin: UTCDateTime;
  readonly zona_horaria: string;
  readonly cobertura: EstadoCobertura;
  readonly estado: EstadoRecolector;
}

export interface AcuseUso {
  readonly event_id: UUID;
  readonly suscripcion_id: UUID;
  readonly estado: 'aceptado' | 'duplicado';
  readonly recibido_en: UTCDateTime;
}

export type CodigoErrorUso =
  | 'evento_invalido'
  | 'version_no_soportada'
  | 'detalle_actividad_invalido'
  | 'intervalo_cruza_dia_local'
  | 'event_id_conflictivo'
  | 'consentimiento_requerido';

export interface ErrorUso {
  readonly codigo: CodigoErrorUso;
  readonly mensaje: string;
}

/**
 * Evento ya validado y normalizado, listo para persistirse.
 *
 * Las fechas se guardan como `Date` y los tramos usan intervalos semiabiertos
 * `[inicio, fin)` en milisegundos. `fechaLocal` es el día local de `inicio` en
 * `zonaHoraria`; la validación garantiza que todo el evento cabe en ese día.
 */
export interface EventoUsoNormalizado {
  readonly organizacionId: UUID;
  readonly suscripcionId: UUID;
  readonly usuarioId: UUID | null;
  readonly eventId: UUID;
  readonly recolectorId: UUID;
  readonly origen: OrigenRecolector;
  readonly inicio: Date;
  readonly fin: Date;
  readonly duracionMs: number;
  readonly tramos: readonly { readonly inicio: Date; readonly fin: Date }[];
  readonly zonaHoraria: string;
  readonly cobertura: EstadoCobertura;
  readonly estado: EstadoRecolector;
  readonly ocurridoEn: Date;
  readonly correlationId: UUID;
  readonly fechaLocal: string;
  /** SHA-256 del contenido tipado + destino; detecta conflictos de `event_id`. */
  readonly huella: string;
}

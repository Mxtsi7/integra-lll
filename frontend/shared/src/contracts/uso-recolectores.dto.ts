/**
 * Contrato canónico de uso de recolectores v1 (S3-VI-01 / S3-MX-01).
 *
 * Fuente de verdad: docs/contratos/uso-recolectores-v1.md y su esquema
 * docs/contratos/uso-recolectores-v1.schema.json. Este archivo es la
 * versión TypeScript de ese contrato para web, móvil y el cliente Windows
 * (ADR-008); se edita solo junto con el contrato, nunca por separado.
 *
 * Sustituye la propuesta previa de la PR #148. La suscripción viaja en la
 * ruta canónica y el cuerpo no lleva usuario_id, organizacion_id ni
 * suscripcion_id: esos datos se resuelven desde la sesión.
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

export interface PendienteUso {
  readonly suscripcion_id: UUID;
  readonly evento: UsageEventPayload;
}

// Solo backend/interno: identidad resuelta por la sesión, destino autorizado.
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

import { randomUUID } from 'node:crypto';

import type {
  UsageEventPayload,
  UsoRegistradoDatos,
  UsoRegistradoEvent,
  UUID,
} from './uso-recolectores.dto';
import { formatearUtc, parsearUtc } from './fechas';
import { validarPayloadUso, validarYNormalizar } from './validacion';

/**
 * S3-VI-07: construcción del sobre publicado tras aceptar un uso.
 *
 * La recepción HTTP autentica y autoriza; aquí se conserva el cuerpo canónico
 * y se añade el tenant/destino ya resueltos. El `event_id` del cuerpo es el
 * `id` del sobre, de modo que reintentos y reentregas conservan identidad.
 */

export const EVENTO_USO_REGISTRADO = 'uso.registrado' as const;
export const ROUTING_KEY_USO = 'uso.registrado';
export const VERSION_USO_RECOLECTORES = 1 as const;

export interface ContextoPublicacionUso {
  readonly organizacionId: UUID;
  readonly suscripcionId: UUID;
  readonly usuarioId?: UUID;
  readonly correlationId?: UUID;
  readonly ocurridoEn?: string;
}

export function crearEventoUsoRegistrado(
  payload: UsageEventPayload,
  contexto: ContextoPublicacionUso,
): UsoRegistradoEvent {
  const cuerpo = validarPayloadUso(payload);
  const ocurridoEn = contexto.ocurridoEn
    ? formatearUtc(parsearUtc(contexto.ocurridoEn))
    : formatearUtc(new Date());

  const datos: UsoRegistradoDatos = {
    ...cuerpo,
    suscripcion_id: contexto.suscripcionId,
    ...(contexto.usuarioId ? { usuario_id: contexto.usuarioId } : {}),
  };

  const evento: UsoRegistradoEvent = {
    evento: EVENTO_USO_REGISTRADO,
    version: VERSION_USO_RECOLECTORES,
    id: cuerpo.event_id,
    ocurrido_en: ocurridoEn,
    correlation_id: contexto.correlationId ?? randomUUID(),
    organizacion_id: contexto.organizacionId,
    datos,
  };

  // Falla antes de publicar si el cuerpo no cumple las reglas semánticas.
  validarYNormalizar(evento);
  return evento;
}

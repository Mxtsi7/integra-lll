import type { CodigoErrorUso } from './uso-recolectores.dto';

/** Error de contrato: el mensaje no se puede aplicar y no se reintenta. */
export class ErrorValidacionUso extends Error {
  constructor(
    public readonly codigo: CodigoErrorUso,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorValidacionUso';
  }
}

/**
 * Misma clave lógica `(organizacion_id, recolector_id, event_id)` con otro
 * contenido o destino. El contrato exige 409 y no sobrescribir lo registrado.
 */
export class ErrorConflictoEvento extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConflictoEvento';
  }
}

/**
 * Error de contrato de un evento de suscripción. El mensaje se rechaza sin
 * reintento: ninguna reentrega va a corregir el cuerpo.
 */
export class ErrorValidacionSuscripcion extends Error {
  constructor(
    public readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorValidacionSuscripcion';
  }
}

/**
 * Mismo `(organizacion_id, event_id)` con otro contenido. No se sobrescribe lo
 * aceptado y el mensaje va a la cola de fallos.
 */
export class ErrorConflictoSuscripcion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConflictoSuscripcion';
  }
}

/** Falta una variable obligatoria o tiene un valor imposible. */
export class ErrorConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConfiguracion';
  }
}

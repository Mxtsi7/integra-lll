import { z } from 'zod';

import type {
  CodigoErrorUso,
  EventoUsoNormalizado,
  UsageEventPayload,
  UsoRegistradoEvent,
} from './uso-recolectores.dto';
import { ErrorValidacionUso } from './errores';
import { parsearUtc, validarDiaLocalUnico } from './fechas';
import { calcularHuella } from './huella';

/**
 * Validación de esquema + reglas semánticas del contrato v1.
 *
 * JSON Schema no puede expresar comparaciones temporales, contención de
 * tramos, suma exacta de duración, zona IANA existente ni cruce de día local.
 * Todo eso se comprueba aquí antes de tocar la base o publicar.
 */

const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;

const esquemaUuid = z.string().uuid();
const esquemaUuidV4 = z.string().regex(UUID_V4, 'se espera un UUID v4');
const esquemaUtc = z.string().regex(UTC, 'se espera un instante UTC terminado en Z');

const esquemaTramo = z
  .object({
    inicio: esquemaUtc,
    fin: esquemaUtc,
  })
  .strict();

/** Cuerpo canónico del recolector: rechaza identidad y destino. */
export const esquemaPayloadUso = z
  .object({
    version: z.literal(1),
    event_id: esquemaUuidV4,
    recolector_id: esquemaUuidV4,
    origen: z.enum(['android', 'navegador']),
    inicio: esquemaUtc,
    fin: esquemaUtc,
    duracion_ms: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    tramos_actividad: z.array(esquemaTramo).max(10_000),
    zona_horaria: z.string().min(1),
    cobertura: z.enum(['completa', 'parcial', 'sin_medicion']),
    estado: z.enum(['activo', 'pausado', 'sin_permiso', 'revocado']),
  })
  .strict();

/** Datos del sobre interno: el cuerpo canónico + destino/tenant autenticados. */
export const esquemaDatosUsoRegistrado = esquemaPayloadUso
  .extend({
    suscripcion_id: esquemaUuid,
    usuario_id: esquemaUuid.optional(),
  })
  .strict();

/** Sobre común del catálogo de eventos. */
export const esquemaEventoUsoRegistrado = z
  .object({
    evento: z.literal('uso.registrado'),
    version: z.literal(1),
    id: esquemaUuidV4,
    ocurrido_en: esquemaUtc,
    correlation_id: esquemaUuid,
    organizacion_id: esquemaUuid,
    datos: esquemaDatosUsoRegistrado,
  })
  .strict();

function codigoDesdeEsquema(error: z.ZodError): CodigoErrorUso {
  const rutas = error.issues.map((issue) => issue.path.join('.'));
  if (rutas.some((ruta) => ruta === 'version' || ruta === 'datos.version')) {
    return 'version_no_soportada';
  }
  if (
    rutas.some(
      (ruta) =>
        ruta.startsWith('datos.tramos_actividad') || ruta === 'datos.duracion_ms',
    )
  ) {
    return 'detalle_actividad_invalido';
  }
  return 'evento_invalido';
}

function detalleDeEsquema(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Valida solo el cuerpo canónico. Útil para la recepción HTTP antes de
 * resolver identidad/destino y para el publicador.
 */
export function validarPayloadUso(valor: unknown): UsageEventPayload {
  const resultado = esquemaPayloadUso.safeParse(valor);
  if (!resultado.success) {
    throw new ErrorValidacionUso(
      codigoDesdeEsquema(resultado.error),
      detalleDeEsquema(resultado.error),
    );
  }
  return resultado.data;
}

/**
 * Valida y normaliza un sobre `uso.registrado` completo.
 *
 * Devuelve fechas `Date`, tramos en orden y `fechaLocal`/`huella` calculadas.
 * Lanza `ErrorValidacionUso` para mensajes que nunca se arreglarán solos.
 */
export function validarYNormalizar(sobre: unknown): EventoUsoNormalizado {
  const resultado = esquemaEventoUsoRegistrado.safeParse(sobre);
  if (!resultado.success) {
    throw new ErrorValidacionUso(
      codigoDesdeEsquema(resultado.error),
      detalleDeEsquema(resultado.error),
    );
  }

  const evento: UsoRegistradoEvent = resultado.data;

  if (evento.id !== evento.datos.event_id) {
    throw new ErrorValidacionUso(
      'evento_invalido',
      `el id del sobre (${evento.id}) no coincide con datos.event_id (${evento.datos.event_id})`,
    );
  }
  if (evento.version !== evento.datos.version) {
    throw new ErrorValidacionUso(
      'version_no_soportada',
      'la versión del sobre y la del cuerpo deben coincidir',
    );
  }

  const inicio = parsearUtc(evento.datos.inicio);
  const fin = parsearUtc(evento.datos.fin);
  const ocurridoEn = parsearUtc(evento.ocurrido_en);

  if (fin.getTime() <= inicio.getTime()) {
    throw new ErrorValidacionUso(
      'detalle_actividad_invalido',
      'la ventana debe cumplir inicio < fin',
    );
  }

  const tramos = evento.datos.tramos_actividad.map((tramo) => ({
    inicio: parsearUtc(tramo.inicio),
    fin: parsearUtc(tramo.fin),
  }));

  let sumaMs = 0;
  let finPrevio: Date | null = null;
  for (const tramo of tramos) {
    if (tramo.fin.getTime() <= tramo.inicio.getTime()) {
      throw new ErrorValidacionUso(
        'detalle_actividad_invalido',
        'cada tramo debe tener duración positiva',
      );
    }
    if (
      tramo.inicio.getTime() < inicio.getTime() ||
      tramo.fin.getTime() > fin.getTime()
    ) {
      throw new ErrorValidacionUso(
        'detalle_actividad_invalido',
        'un tramo está fuera de la ventana [inicio, fin)',
      );
    }
    if (finPrevio && tramo.inicio.getTime() < finPrevio.getTime()) {
      throw new ErrorValidacionUso(
        'detalle_actividad_invalido',
        'los tramos deben estar ordenados y no solaparse entre sí',
      );
    }
    sumaMs += tramo.fin.getTime() - tramo.inicio.getTime();
    finPrevio = tramo.fin;
  }

  if (!Number.isSafeInteger(sumaMs)) {
    throw new ErrorValidacionUso(
      'detalle_actividad_invalido',
      'la duración total excede el rango seguro de milisegundos',
    );
  }
  if (sumaMs !== evento.datos.duracion_ms) {
    throw new ErrorValidacionUso(
      'detalle_actividad_invalido',
      `duracion_ms (${evento.datos.duracion_ms}) no coincide con la suma de los tramos (${sumaMs})`,
    );
  }
  if (evento.datos.duracion_ms > fin.getTime() - inicio.getTime()) {
    throw new ErrorValidacionUso(
      'detalle_actividad_invalido',
      'duracion_ms no puede superar la ventana observada',
    );
  }

  if (evento.datos.estado !== 'activo' && evento.datos.duracion_ms > 0) {
    throw new ErrorValidacionUso(
      'detalle_actividad_invalido',
      `estado ${evento.datos.estado} no puede informar actividad positiva`,
    );
  }
  if (evento.datos.cobertura === 'sin_medicion' && evento.datos.duracion_ms > 0) {
    throw new ErrorValidacionUso(
      'detalle_actividad_invalido',
      'cobertura sin_medicion no puede informar actividad positiva',
    );
  }

  const fechaLocal = validarDiaLocalUnico(inicio, fin, evento.datos.zona_horaria);

  const huella = calcularHuella({
    organizacionId: evento.organizacion_id,
    suscripcionId: evento.datos.suscripcion_id,
    usuarioId: evento.datos.usuario_id ?? null,
    eventId: evento.datos.event_id,
    recolectorId: evento.datos.recolector_id,
    origen: evento.datos.origen,
    inicio,
    fin,
    duracionMs: evento.datos.duracion_ms,
    tramos,
    zonaHoraria: evento.datos.zona_horaria,
    cobertura: evento.datos.cobertura,
    estado: evento.datos.estado,
  });

  return {
    organizacionId: evento.organizacion_id,
    suscripcionId: evento.datos.suscripcion_id,
    usuarioId: evento.datos.usuario_id ?? null,
    eventId: evento.datos.event_id,
    recolectorId: evento.datos.recolector_id,
    origen: evento.datos.origen,
    inicio,
    fin,
    duracionMs: evento.datos.duracion_ms,
    tramos,
    zonaHoraria: evento.datos.zona_horaria,
    cobertura: evento.datos.cobertura,
    estado: evento.datos.estado,
    ocurridoEn,
    correlationId: evento.correlation_id,
    fechaLocal,
    huella,
  };
}

import { z } from 'zod';

import {
  ErrorValidacionSuscripcion,
} from './errores';
import {
  serializarEstable,
} from './huella';
import type {
  EventoEstadoSuscripcion,
  EventoSuscripcionEstadoNormalizado,
  SuscripcionEstadoEvent,
} from './suscripcion-estado.dto';
import { parsearUtc } from './fechas';
import { createHash } from 'node:crypto';

/**
 * Validación del contrato MX-21 v2 y de las reglas que el JSON Schema no
 * expresa: fechas de calendario reales y monto con exactitud decimal.
 *
 * Un evento inválido no se reintenta. La huella se calcula sobre campos
 * tipados y ordenados para que una reentrega idéntica sea un duplicado y un
 * `event_id` reutilizado con otro contenido sea un conflicto.
 */

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;
const FECHA = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MONTO = /^(?!0[.]00$)(0|[1-9][0-9]{0,7})[.][0-9]{2}$/;
const MONEDA = /^[A-Z]{3}$/;

const esquemaUuid = z.string().regex(UUID, 'se espera un UUID');
const esquemaUtc = z.string().regex(UTC, 'se espera un instante UTC terminado en Z');
const esquemaFecha = z.string().regex(FECHA, 'se espera una fecha YYYY-MM-DD');

const esquemaEstado = z.enum([
  'prueba',
  'activo',
  'por_confirmar',
  'cancelado',
  'fantasma',
]);

const esquemaEventoEstado = z.enum([
  'fin_prueba',
  'fallo_cobro_inicial',
  'cancelacion_usuario',
  'fallo_cobro',
  'cobro_regularizado',
  'confirmacion_usuario',
  'sin_cobros_60_dias',
  'sin_respuesta_30_dias',
  'sin_uso_45_dias',
  'uso_registrado',
  'cobro_nuevo_detectado',
  'reactivacion_usuario',
]);

const esquemaDatos = z
  .object({
    suscripcion_id: esquemaUuid,
    proveedor_id: esquemaUuid.nullable(),
    nombre: z.string().min(1).max(100),
    monto: z.string().regex(MONTO, 'el monto debe tener dos decimales exactos'),
    moneda: z.string().regex(MONEDA, 'la moneda debe ser un código ISO de 3 letras'),
    ciclo: z.enum(['mensual', 'anual']),
    proximo_cobro: esquemaFecha,
    estado: esquemaEstado,
    fin_prueba: esquemaFecha.nullable().optional(),
    estado_anterior: esquemaEstado,
    evento_estado: esquemaEventoEstado,
  })
  .strict();

const esquemaEvento = z
  .object({
    evento: z.literal('suscripcion.estado_cambiado'),
    version: z.literal(2),
    id: esquemaUuid,
    ocurrido_en: esquemaUtc,
    correlation_id: esquemaUuid,
    organizacion_id: esquemaUuid,
    datos: esquemaDatos,
  })
  .strict();

function validarFechaDeCalendario(texto: string) {
  if (!FECHA.test(texto)) {
    throw new ErrorValidacionSuscripcion(
      'fecha_invalida',
      `fecha inválida: ${texto}`,
    );
  }
  const [anio, mes, dia] = texto.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(2000, 0, 1));
  fecha.setUTCFullYear(anio, mes - 1, dia);
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new ErrorValidacionSuscripcion(
      'fecha_invalida',
      `fecha inexistente: ${texto}`,
    );
  }
  return texto;
}

function parsearInstante(texto: string): Date {
  try {
    return parsearUtc(texto);
  } catch (error) {
    throw new ErrorValidacionSuscripcion(
      'instante_invalido',
      error instanceof Error ? error.message : `instante inválido: ${texto}`,
    );
  }
}

function calcularHuellaSuscripcion(
  evento: Omit<EventoSuscripcionEstadoNormalizado, 'huella'>,
): string {
  const material = {
    organizacion_id: evento.organizacionId,
    event_id: evento.eventId,
    correlation_id: evento.correlationId,
    ocurrido_en: evento.ocurridoEn.toISOString(),
    suscripcion_id: evento.suscripcionId,
    proveedor_id: evento.proveedorId,
    nombre: evento.nombre,
    monto: evento.monto,
    moneda: evento.moneda,
    ciclo: evento.ciclo,
    proximo_cobro: evento.proximoCobro,
    estado: evento.estado,
    fin_prueba: evento.finPrueba,
    estado_anterior: evento.estadoAnterior,
    evento_estado: evento.eventoEstado,
  };
  return createHash('sha256')
    .update(serializarEstable(material), 'utf8')
    .digest('hex');
}

export function validarYNormalizarSuscripcion(
  sobre: unknown,
): EventoSuscripcionEstadoNormalizado {
  const resultado = esquemaEvento.safeParse(sobre);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('; ');
    throw new ErrorValidacionSuscripcion('evento_invalido', detalle);
  }

  const evento: SuscripcionEstadoEvent = resultado.data;
  const datos = evento.datos;

  const normalizado: Omit<EventoSuscripcionEstadoNormalizado, 'huella'> = {
    organizacionId: evento.organizacion_id,
    eventId: evento.id,
    correlationId: evento.correlation_id,
    ocurridoEn: parsearInstante(evento.ocurrido_en),
    suscripcionId: datos.suscripcion_id,
    proveedorId: datos.proveedor_id,
    nombre: datos.nombre,
    monto: datos.monto,
    moneda: datos.moneda,
    ciclo: datos.ciclo,
    proximoCobro: validarFechaDeCalendario(datos.proximo_cobro),
    estado: datos.estado,
    finPrueba:
      datos.fin_prueba === undefined || datos.fin_prueba === null
        ? null
        : validarFechaDeCalendario(datos.fin_prueba),
    estadoAnterior: datos.estado_anterior,
    eventoEstado: datos.evento_estado as EventoEstadoSuscripcion,
  };

  return { ...normalizado, huella: calcularHuellaSuscripcion(normalizado) };
}

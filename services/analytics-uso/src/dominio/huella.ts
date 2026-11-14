import { createHash } from 'node:crypto';

/**
 * Huella canónica del contenido de un evento.
 *
 * La idempotencia compara campos tipados, no texto JSON: el mismo evento con
 * las claves en otro orden debe producir la misma huella. La suscripción y el
 * tenant forman parte del contenido porque un `event_id` repetido con otro
 * destino es un conflicto (`409 event_id_conflictivo`).
 */

export interface ContenidoHuella {
  readonly organizacionId: string;
  readonly suscripcionId: string;
  readonly usuarioId: string | null;
  readonly eventId: string;
  readonly recolectorId: string;
  readonly origen: string;
  readonly inicio: Date;
  readonly fin: Date;
  readonly duracionMs: number;
  readonly tramos: readonly { readonly inicio: Date; readonly fin: Date }[];
  readonly zonaHoraria: string;
  readonly cobertura: string;
  readonly estado: string;
}

/** Serialización estable: claves de objeto ordenadas, arrays en su orden. */
export function serializarEstable(valor: unknown): string {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) {
    return `[${valor.map((elemento) => serializarEstable(elemento)).join(',')}]`;
  }
  if (typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;
    const claves = Object.keys(objeto).sort();
    return `{${claves
      .map((clave) => `${JSON.stringify(clave)}:${serializarEstable(objeto[clave])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

export function calcularHuella(contenido: ContenidoHuella): string {
  const material = {
    organizacion_id: contenido.organizacionId,
    suscripcion_id: contenido.suscripcionId,
    usuario_id: contenido.usuarioId,
    version: 1,
    event_id: contenido.eventId,
    recolector_id: contenido.recolectorId,
    origen: contenido.origen,
    inicio: contenido.inicio.toISOString(),
    fin: contenido.fin.toISOString(),
    duracion_ms: contenido.duracionMs,
    tramos_actividad: contenido.tramos.map((tramo) => ({
      inicio: tramo.inicio.toISOString(),
      fin: tramo.fin.toISOString(),
    })),
    zona_horaria: contenido.zonaHoraria,
    cobertura: contenido.cobertura,
    estado: contenido.estado,
  };
  return createHash('sha256').update(serializarEstable(material), 'utf8').digest('hex');
}

import type { PoolClient } from 'pg';

/**
 * Misma barrera que `shared/borrado/bloqueo.py`.
 *
 * La limpieza de un tenant toma la fila con `FOR UPDATE` y marca
 * `eliminada = true` en la misma transacción. Las escrituras toman
 * `FOR SHARE`: avanzan en paralelo entre sí, pero esperan a que la limpieza
 * confirme y, al leer el estado, abortan si el tenant ya fue eliminado.
 *
 * La fila puede no existir antes del primer borrado (Django la crea con
 * `get_or_create`). Por eso se inserta con `ON CONFLICT DO NOTHING` antes de
 * bloquear. Ese upsert es parte de adquirir la barrera, no una escritura de
 * uso: nunca hay un INSERT en `analytics.uso_*` antes de este punto.
 */
const TABLA_ESTADO = 'analytics.estado_eliminacion_organizacion';

export interface EstadoTenant {
  readonly eliminada: boolean;
}

export async function bloquearOrganizacionCompartido(
  cliente: PoolClient,
  organizacionId: string,
): Promise<EstadoTenant> {
  await cliente.query(
    `
      INSERT INTO ${TABLA_ESTADO} (organizacion_id, eliminada)
      VALUES ($1, false)
      ON CONFLICT (organizacion_id) DO NOTHING
    `,
    [organizacionId],
  );

  const resultado = await cliente.query<EstadoTenant>(
    `
      SELECT eliminada
      FROM ${TABLA_ESTADO}
      WHERE organizacion_id = $1
      FOR SHARE
    `,
    [organizacionId],
  );

  const fila = resultado.rows[0];
  if (!fila) {
    // La fila no se borra, pero una respuesta vacía convertiría un error de
    // infraestructura en una escritura sin barrera. Mejor fallar y reintentar.
    throw new Error(
      'no se pudo leer el estado de eliminación de la organización',
    );
  }

  return fila;
}

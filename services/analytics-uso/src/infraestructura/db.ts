import { Pool } from 'pg';

/**
 * Pool de PostgreSQL del servicio.
 *
 * Las tablas viven en el esquema `analytics`, que ya existe en la base
 * compartida (infra/migraciones/01-esquemas.sql). No se tocan las tablas de
 * Django: este pipeline usa nombres `uso_*` propios.
 */
export function crearPool(databaseUrl: string, maximo = 10): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: maximo,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'analytics-uso',
  });

  pool.on('error', (error) => {
    // Un cliente idle que muere no debe tumbar el proceso; el pool lo repone.
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        nivel: 'error',
        mensaje: 'error en cliente idle de PostgreSQL',
        error: error.message,
      }),
    );
  });

  return pool;
}

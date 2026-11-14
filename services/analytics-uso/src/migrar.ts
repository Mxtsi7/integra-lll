import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ErrorConfiguracion } from './dominio/errores';
import { crearPool } from './infraestructura/db';

/**
 * Aplica el DDL del servicio. Es idempotente (`IF NOT EXISTS`), pero está
 * pensado para ejecutarse una sola vez por despliegue, antes del worker.
 *
 * Solo necesita `DATABASE_URL`: no abre RabbitMQ.
 */
async function principal(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ErrorConfiguracion('falta la variable de entorno DATABASE_URL');
  }

  const ruta =
    process.env.SQL_MIGRACION?.trim() ||
    path.resolve(__dirname, '..', 'sql', '001_uso_recolectores.sql');

  const sql = await readFile(ruta, 'utf8');
  const pool = crearPool(databaseUrl, 1);

  try {
    await pool.query(sql);
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        nivel: 'info',
        mensaje: 'migración de analytics-uso aplicada',
        archivo: ruta,
      }),
    );
  } finally {
    await pool.end();
  }
}

principal().catch((error) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      nivel: 'error',
      mensaje: 'no se pudo aplicar la migración de analytics-uso',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

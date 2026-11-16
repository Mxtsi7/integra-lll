import 'dotenv/config';

import amqp from 'amqplib';

import { cargarConfig } from './infraestructura/config';
import { crearPool } from './infraestructura/db';

/**
 * Healthcheck del worker: comprueba base y broker. No declara sano un proceso
 * que sigue vivo pero perdió la conexión.
 */
async function principal(): Promise<void> {
  const config = cargarConfig();
  const pool = crearPool(config.databaseUrl, 1);

  try {
    await pool.query('SELECT 1');
    const conexion = await amqp.connect(config.rabbitUrl);
    await conexion.close();
    console.log('ok');
  } finally {
    await pool.end();
  }
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

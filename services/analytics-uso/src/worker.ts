import 'dotenv/config';

import { ProcesadorUso } from './aplicacion/procesador-uso';
import { ConsumidorUso } from './consumidor/uso.consumer';
import { cargarConfig } from './infraestructura/config';
import { crearPool } from './infraestructura/db';
import { crearLogger, describirError } from './infraestructura/logger';
import { RepositorioUsoPostgres } from './infraestructura/repositorio-uso-postgres';

/**
 * Punto de entrada del worker (S3-VI-09/S3-VI-10).
 *
 * No aplica migraciones: el compose/despliegue ejecuta `dist/migrar.js` una
 * sola vez. Así varias réplicas del worker no compiten por el mismo DDL.
 */
async function principal(): Promise<void> {
  const config = cargarConfig();
  const logger = crearLogger(config.logLevel);
  const pool = crearPool(config.databaseUrl);
  const repositorio = new RepositorioUsoPostgres(pool);
  const procesador = new ProcesadorUso(repositorio);

  const consumidor = await ConsumidorUso.crear({
    url: config.rabbitUrl,
    config,
    procesador,
    logger,
  });

  await consumidor.iniciar();
  logger.info('worker de analytics-uso listo', {
    cola: config.colaUso,
    exchange: config.exchangeUso,
    routingKey: config.routingKeyUso,
    maxReintentos: config.maxReintentos,
  });

  let deteniendo = false;
  const detener = async (senal: string): Promise<void> => {
    if (deteniendo) return;
    deteniendo = true;
    logger.info('señal recibida; cerrando worker', { senal });
    try {
      await consumidor.detener();
      await pool.end();
    } catch (error) {
      logger.error('error al cerrar el worker', describirError(error));
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void detener('SIGINT'));
  process.on('SIGTERM', () => void detener('SIGTERM'));
}

principal().catch((error) => {
  const logger = crearLogger();
  logger.error('no se pudo iniciar el worker de analytics-uso', describirError(error));
  process.exit(1);
});

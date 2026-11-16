import 'dotenv/config';

import { ProcesadorSuscripcion } from './aplicacion/procesador-suscripcion';
import { ProcesadorUso } from './aplicacion/procesador-uso';
import { ConsumidorSuscripcion } from './consumidor/suscripcion.consumer';
import { ConsumidorUso } from './consumidor/uso.consumer';
import { cargarConfig } from './infraestructura/config';
import { crearPool } from './infraestructura/db';
import { crearLogger, describirError } from './infraestructura/logger';
import { RepositorioSuscripcionPostgres } from './infraestructura/repositorio-suscripcion-postgres';
import { RepositorioUsoPostgres } from './infraestructura/repositorio-uso-postgres';

/**
 * Punto de entrada del worker (S3-VI-09/S3-VI-10).
 *
 * Dos consumidores independientes sobre el mismo pool:
 * - `analytics.uso.cola` para los hechos de uso de recolectores;
 * - `analytics.suscripciones.estado` para el estado vigente de suscripciones.
 *
 * No aplica migraciones: el compose/despliegue ejecuta `dist/migrar.js` una
 * sola vez. Así varias réplicas del worker no compiten por el mismo DDL.
 */
async function principal(): Promise<void> {
  const config = cargarConfig();
  const logger = crearLogger(config.logLevel);
  const pool = crearPool(config.databaseUrl);

  const procesadorUso = new ProcesadorUso(
    new RepositorioUsoPostgres(pool),
  );
  const procesadorSuscripcion = new ProcesadorSuscripcion(
    new RepositorioSuscripcionPostgres(pool),
  );

  const consumidorUso = await ConsumidorUso.crear({
    url: config.rabbitUrl,
    config,
    procesador: procesadorUso,
    logger,
  });
  const consumidorSuscripcion = await ConsumidorSuscripcion.crear({
    url: config.rabbitUrl,
    config,
    procesador: procesadorSuscripcion,
    logger,
  });

  await consumidorUso.iniciar();
  await consumidorSuscripcion.iniciar();
  logger.info('worker de analytics-uso listo', {
    colaUso: config.colaUso,
    exchangeUso: config.exchangeUso,
    routingKeyUso: config.routingKeyUso,
    colaSuscripcionEstado: config.colaSuscripcionEstado,
    exchangeSuscripciones: config.exchangeSuscripciones,
    routingKeySuscripcionEstado: config.routingKeySuscripcionEstado,
    maxReintentos: config.maxReintentos,
  });

  let deteniendo = false;
  const detener = async (senal: string): Promise<void> => {
    if (deteniendo) return;
    deteniendo = true;
    logger.info('señal recibida; cerrando worker', { senal });
    try {
      await Promise.all([
        consumidorUso.detener(),
        consumidorSuscripcion.detener(),
      ]);
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

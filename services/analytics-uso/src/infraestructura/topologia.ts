import type { Channel } from 'amqplib';

import type { Config } from './config';

/**
 * S3-VI-10: topología RabbitMQ del consumo de uso.
 *
 * - Exchange `uso.eventos` (topic, durable), separado del histórico
 *   `suscripciones` para no mezclar el contrato nuevo con `uso.registrado`
 *   v1 de connectors.
 * - Cola `analytics.uso.cola` (quorum, durable) con límite de entregas.
 * - DLX `uso.eventos.dlx` y cola de fallos `analytics.uso.fallos`.
 *
 * Los mensajes inválidos o conflictivos se rechazan sin requeue y quedan en la
 * cola de fallos. Los fallos transitorios se reencolan; el `x-delivery-limit`
 * evita un bucle infinito y termina en la DLQ.
 */
export async function declararTopologia(canal: Channel, config: Config): Promise<void> {
  await canal.assertExchange(config.exchangeUso, 'topic', { durable: true });
  await canal.assertExchange(config.exchangeDlx, 'topic', { durable: true });

  await canal.assertQueue(config.colaFallos, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
    },
  });
  await canal.bindQueue(config.colaFallos, config.exchangeDlx, '#');

  await canal.assertQueue(config.colaUso, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': config.exchangeDlx,
      'x-dead-letter-routing-key': config.routingKeyUso,
      'x-delivery-limit': config.maxReintentos,
    },
  });
  await canal.bindQueue(config.colaUso, config.exchangeUso, config.routingKeyUso);
}

/**
 * S3-VI-10: consumo de `suscripcion.estado_cambiado.v2`.
 *
 * Reutiliza el exchange `suscripciones` y el DLX `suscripciones.fallidos` que
 * ya declara el publicador de Subscriptions. La cola de Analytics es propia
 * (`analytics.suscripciones.estado`) para no competir con
 * `subscriptions.resumen`: cada consumidor recibe su copia.
 *
 * La cola principal es quorum con `x-delivery-limit`: un fallo transitorio se
 * reencola y termina en la cola de fallos, igual que el pipeline de uso.
 */
export async function declararTopologiaSuscripciones(
  canal: Channel,
  config: Config,
): Promise<void> {
  await canal.assertExchange(config.exchangeSuscripciones, 'topic', {
    durable: true,
  });
  await canal.assertExchange(config.exchangeFallidosSuscripciones, 'fanout', {
    durable: true,
  });

  await canal.assertQueue(config.colaFallosSuscripcionEstado, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
    },
  });
  await canal.bindQueue(
    config.colaFallosSuscripcionEstado,
    config.exchangeFallidosSuscripciones,
    '',
  );

  await canal.assertQueue(config.colaSuscripcionEstado, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': config.exchangeFallidosSuscripciones,
      'x-delivery-limit': config.maxReintentos,
    },
  });
  await canal.bindQueue(
    config.colaSuscripcionEstado,
    config.exchangeSuscripciones,
    config.routingKeySuscripcionEstado,
  );
}

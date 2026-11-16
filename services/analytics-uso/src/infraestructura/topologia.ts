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

import { once } from 'node:events';

import amqp, {
  type ChannelModel,
  type ConfirmChannel,
} from 'amqplib';

import type {
  UsageEventPayload,
  UsoRegistradoEvent,
} from '../dominio/uso-recolectores.dto';
import { validarYNormalizar } from '../dominio/validacion';
import {
  crearEventoUsoRegistrado,
  type ContextoPublicacionUso,
} from '../dominio/uso-registrado.event';
import { crearLogger, describirError, type Logger } from '../infraestructura/logger';

/**
 * S3-VI-07: publicador fiable de `uso.registrado`.
 *
 * Publica en el exchange dedicado `uso.eventos` con routing key
 * `uso.registrado`, modo persistente, `message_id = event_id` y
 * `correlation_id` del sobre. Usa confirms y `mandatory`: si no hay ruta, la
 * publicación falla en vez de perder el hecho en silencio.
 *
 * RabbitMQ no promete entrega exactamente una vez. El consumidor deduplica por
 * `(organizacion_id, recolector_id, event_id)` y la huella del contenido.
 */

export interface OpcionesPublicador {
  readonly url: string;
  readonly exchangeUso?: string;
  readonly routingKeyUso?: string;
  readonly logger?: Logger;
}

export class PublicadorUso {
  private readonly devueltos = new Set<string>();

  private constructor(
    private readonly conexion: ChannelModel,
    private readonly canal: ConfirmChannel,
    private readonly opciones: Required<Pick<OpcionesPublicador, 'exchangeUso' | 'routingKeyUso'>>,
    private readonly logger: Logger,
  ) {
    this.canal.on('return', (mensaje) => {
      const id = mensaje.properties.messageId;
      if (id) this.devueltos.add(id);
    });
  }

  static async crear(opciones: OpcionesPublicador): Promise<PublicadorUso> {
    const logger = opciones.logger ?? crearLogger();
    const conexion = await amqp.connect(opciones.url);
    const canal = await conexion.createConfirmChannel();
    const resuelto = {
      exchangeUso: opciones.exchangeUso ?? 'uso.eventos',
      routingKeyUso: opciones.routingKeyUso ?? 'uso.registrado',
    };

    await canal.assertExchange(resuelto.exchangeUso, 'topic', { durable: true });

    conexion.on('error', (error) => {
      logger.error('error en conexión RabbitMQ del publicador', describirError(error));
    });
    canal.on('error', (error) => {
      logger.error('error en canal RabbitMQ del publicador', describirError(error));
    });

    return new PublicadorUso(conexion, canal, resuelto, logger);
  }

  /**
   * Publica un sobre ya construido. Valida antes de publicar: un evento
   * inválido no debe llegar al broker.
   */
  async publicar(evento: UsoRegistradoEvent): Promise<void> {
    validarYNormalizar(evento);

    const contenido = Buffer.from(JSON.stringify(evento), 'utf8');
    const aceptado = this.canal.publish(
      this.opciones.exchangeUso,
      this.opciones.routingKeyUso,
      contenido,
      {
        persistent: true,
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        messageId: evento.id,
        correlationId: evento.correlation_id,
        type: evento.evento,
        appId: 'analytics-uso',
        timestamp: Math.floor(Date.now() / 1000),
        mandatory: true,
        headers: {
          version: evento.version,
          organizacion_id: evento.organizacion_id,
        },
      },
    );

    if (!aceptado) {
      await once(this.canal, 'drain');
    }
    await this.canal.waitForConfirms();

    if (this.devueltos.delete(evento.id)) {
      throw new Error(
        `RabbitMQ no encontró ruta para ${evento.evento} en ${this.opciones.exchangeUso}/${this.opciones.routingKeyUso}`,
      );
    }

    this.logger.info('uso publicado', {
      eventId: evento.id,
      organizacionId: evento.organizacion_id,
      suscripcionId: evento.datos.suscripcion_id,
      routingKey: this.opciones.routingKeyUso,
    });
  }

  /** Atajo para la recepción: construye, valida y publica en un paso. */
  async publicarPayload(
    payload: UsageEventPayload,
    contexto: ContextoPublicacionUso,
  ): Promise<UsoRegistradoEvent> {
    const evento = crearEventoUsoRegistrado(payload, contexto);
    await this.publicar(evento);
    return evento;
  }

  async cerrar(): Promise<void> {
    try {
      await this.canal.close();
    } finally {
      await this.conexion.close();
    }
  }
}

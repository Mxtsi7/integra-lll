import amqp, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from 'amqplib';

import type { ProcesadorSuscripcion } from '../aplicacion/procesador-suscripcion';
import type { ResultadoProyeccionSuscripcion } from '../aplicacion/repositorio-suscripcion';
import {
  ErrorConflictoSuscripcion,
  ErrorValidacionSuscripcion,
} from '../dominio/errores';
import type { Config } from '../infraestructura/config';
import { crearLogger, describirError, type Logger } from '../infraestructura/logger';
import { declararTopologiaSuscripciones } from '../infraestructura/topologia';

export type AccionMensajeSuscripcion = 'ack' | 'rechazar' | 'reintentar';

export function decidirAccionSuscripcion(
  error: unknown,
): AccionMensajeSuscripcion {
  if (
    error instanceof ErrorValidacionSuscripcion ||
    error instanceof ErrorConflictoSuscripcion
  ) {
    return 'rechazar';
  }
  return 'reintentar';
}

export interface OpcionesConsumidorSuscripcion {
  readonly url: string;
  readonly config: Config;
  readonly procesador: ProcesadorSuscripcion;
  readonly logger?: Logger;
}

const MAX_BYTES_MENSAJE = 64 * 1024;

/**
 * S3-VI-10: worker que escucha `analytics.suscripciones.estado`.
 *
 * ACK solo después del commit. Un duplicado, un evento obsoleto y un evento de
 * una organización eliminada se confirman sin efectos. Un cuerpo inválido o
 * conflictivo se rechaza sin requeue; un fallo de infraestructura se reencola
 * y el `x-delivery-limit` lo termina enviando a la cola de fallos.
 */
export class ConsumidorSuscripcion {
  private readonly logger: Logger;
  private detenido = false;

  private constructor(
    private readonly conexion: ChannelModel,
    private readonly canal: Channel,
    private readonly config: Config,
    private readonly procesador: ProcesadorSuscripcion,
    logger?: Logger,
  ) {
    this.logger = logger ?? crearLogger(config.logLevel);
  }

  static async crear(
    opciones: OpcionesConsumidorSuscripcion,
  ): Promise<ConsumidorSuscripcion> {
    const logger = opciones.logger ?? crearLogger(opciones.config.logLevel);
    const conexion = await amqp.connect(opciones.url);
    const canal = await conexion.createChannel();

    conexion.on('error', (error) => {
      logger.error(
        'error en conexión RabbitMQ del consumidor de suscripciones',
        describirError(error),
      );
    });
    canal.on('error', (error) => {
      logger.error(
        'error en canal RabbitMQ del consumidor de suscripciones',
        describirError(error),
      );
    });

    await canal.prefetch(opciones.config.prefetch);
    await declararTopologiaSuscripciones(canal, opciones.config);

    return new ConsumidorSuscripcion(
      conexion,
      canal,
      opciones.config,
      opciones.procesador,
      logger,
    );
  }

  async iniciar(): Promise<void> {
    await this.canal.consume(
      this.config.colaSuscripcionEstado,
      (mensaje) => {
        if (!mensaje) return;
        void this.procesar(mensaje);
      },
      { noAck: false },
    );

    this.logger.info('consumidor de estado de suscripciones iniciado', {
      cola: this.config.colaSuscripcionEstado,
      exchange: this.config.exchangeSuscripciones,
      routingKey: this.config.routingKeySuscripcionEstado,
      prefetch: this.config.prefetch,
    });
  }

  private async procesar(mensaje: ConsumeMessage): Promise<void> {
    const eventId = mensaje.properties.messageId;
    const inicio = Date.now();

    if (mensaje.content.length > MAX_BYTES_MENSAJE) {
      this.logger.warn(
        'mensaje de suscripción demasiado grande; se envía a la cola de fallos',
        {
          eventId,
          bytes: mensaje.content.length,
          maximo: MAX_BYTES_MENSAJE,
        },
      );
      this.canal.reject(mensaje, false);
      return;
    }

    let sobre: unknown;
    try {
      sobre = JSON.parse(mensaje.content.toString('utf8'));
    } catch (error) {
      this.logger.warn(
        'mensaje de suscripción con JSON inválido; se envía a la cola de fallos',
        {
          eventId,
          ...describirError(error),
        },
      );
      this.canal.reject(mensaje, false);
      return;
    }

    try {
      const resultado = await this.procesador.procesar(sobre);
      this.canal.ack(mensaje);
      this.logger.info(mensajeDeResultado(resultado), {
        eventId,
        resultado,
        duracionMs: Date.now() - inicio,
      });
    } catch (error) {
      const accion = decidirAccionSuscripcion(error);

      if (accion === 'rechazar') {
        this.logger.warn(
          'suscripción rechazada sin reintento; se envía a la cola de fallos',
          {
            eventId,
            ...describirError(error),
          },
        );
        this.canal.reject(mensaje, false);
        return;
      }

      this.logger.error(
        'fallo transitorio al procesar suscripción; se reencola',
        {
          eventId,
          ...describirError(error),
        },
      );

      await esperar(500);
      try {
        this.canal.nack(mensaje, false, true);
      } catch (errorNack) {
        this.logger.error('no se pudo reencolar el mensaje de suscripción', {
          eventId,
          ...describirError(errorNack),
        });
      }
    }
  }

  async detener(): Promise<void> {
    if (this.detenido) return;
    this.detenido = true;
    this.logger.info('deteniendo consumidor de estado de suscripciones');
    try {
      await this.canal.close();
    } finally {
      await this.conexion.close();
    }
  }
}

function mensajeDeResultado(
  resultado: ResultadoProyeccionSuscripcion,
): string {
  if (resultado === 'duplicado') {
    return 'proyección de suscripción duplicada confirmada sin efectos';
  }
  if (resultado === 'obsoleto') {
    return 'suscripción obsoleta confirmada sin efectos';
  }
  if (resultado === 'ignorado') {
    return 'suscripción de organización eliminada confirmada sin efectos';
  }
  return 'suscripción aplicada';
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

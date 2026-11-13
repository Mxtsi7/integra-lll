import amqp, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from 'amqplib';

import type { ProcesadorUso } from '../aplicacion/procesador-uso';
import type { ResultadoRegistroUso } from '../aplicacion/repositorio-uso';
import { ErrorConflictoEvento, ErrorValidacionUso } from '../dominio/errores';
import type { Config } from '../infraestructura/config';
import { crearLogger, describirError, type Logger } from '../infraestructura/logger';
import { declararTopologia } from '../infraestructura/topologia';

/**
 * Acción ante un mensaje fallido:
 * - `ack`: no aplica (el procesador devuelve duplicado/aplicado).
 * - `rechazar`: error permanente; `reject(requeue=false)` -> DLQ.
 * - `reintentar`: fallo transitorio; `nack(requeue=true)` y el
 *   `x-delivery-limit` de la cola termina en DLQ tras N entregas.
 */
export type AccionMensaje = 'ack' | 'rechazar' | 'reintentar';

export function decidirAccion(error: unknown): AccionMensaje {
  if (error instanceof ErrorValidacionUso || error instanceof ErrorConflictoEvento) {
    return 'rechazar';
  }
  return 'reintentar';
}

export interface OpcionesConsumidor {
  readonly url: string;
  readonly config: Config;
  readonly procesador: ProcesadorUso;
  readonly logger?: Logger;
}

/**
 * Límite defensivo del mensaje interno. La recepción HTTP aplica el límite de
 * 4 KiB del contrato al cuerpo canónico; el sobre de RabbitMQ añade metadatos,
 * por eso aquí se usa un margen mayor. Un mensaje mayor no se parsea.
 */
const MAX_BYTES_MENSAJE = 64 * 1024;

/**
 * S3-VI-09/S3-VI-10: worker que escucha `analytics.uso.cola`.
 *
 * ACK después del commit del repositorio. Un duplicado también se ACK (sin
 * efectos). Un mensaje inválido o conflictivo se rechaza sin requeue. Un fallo
 * de base/broker se reencola; el límite de entregas de la cola evita el bucle
 * infinito y deja el mensaje en la cola de fallos.
 */
export class ConsumidorUso {
  private readonly logger: Logger;
  private detenido = false;

  private constructor(
    private readonly conexion: ChannelModel,
    private readonly canal: Channel,
    private readonly config: Config,
    private readonly procesador: ProcesadorUso,
    logger?: Logger,
  ) {
    this.logger = logger ?? crearLogger(config.logLevel);
  }

  static async crear(opciones: OpcionesConsumidor): Promise<ConsumidorUso> {
    const logger = opciones.logger ?? crearLogger(opciones.config.logLevel);
    const conexion = await amqp.connect(opciones.url);
    const canal = await conexion.createChannel();

    conexion.on('error', (error) => {
      logger.error('error en conexión RabbitMQ del consumidor', describirError(error));
    });
    canal.on('error', (error) => {
      logger.error('error en canal RabbitMQ del consumidor', describirError(error));
    });

    await canal.prefetch(opciones.config.prefetch);
    await declararTopologia(canal, opciones.config);

    return new ConsumidorUso(
      conexion,
      canal,
      opciones.config,
      opciones.procesador,
      logger,
    );
  }

  async iniciar(): Promise<void> {
    await this.canal.consume(
      this.config.colaUso,
      (mensaje) => {
        if (!mensaje) return;
        void this.procesar(mensaje);
      },
      { noAck: false },
    );

    this.logger.info('consumidor de uso iniciado', {
      cola: this.config.colaUso,
      exchange: this.config.exchangeUso,
      routingKey: this.config.routingKeyUso,
      prefetch: this.config.prefetch,
    });
  }

  private async procesar(mensaje: ConsumeMessage): Promise<void> {
    const eventId = mensaje.properties.messageId;
    const inicio = Date.now();

    if (mensaje.content.length > MAX_BYTES_MENSAJE) {
      this.logger.warn('mensaje demasiado grande; se envía a la cola de fallos', {
        eventId,
        bytes: mensaje.content.length,
        maximo: MAX_BYTES_MENSAJE,
      });
      this.canal.reject(mensaje, false);
      return;
    }

    let sobre: unknown;
    try {
      sobre = JSON.parse(mensaje.content.toString('utf8'));
    } catch (error) {
      this.logger.warn('mensaje con JSON inválido; se envía a la cola de fallos', {
        eventId,
        ...describirError(error),
      });
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
      const accion = decidirAccion(error);

      if (accion === 'rechazar') {
        this.logger.warn('uso rechazado sin reintento; se envía a la cola de fallos', {
          eventId,
          ...describirError(error),
        });
        this.canal.reject(mensaje, false);
        return;
      }

      this.logger.error('fallo transitorio al procesar uso; se reencola', {
        eventId,
        ...describirError(error),
      });

      // Pequeña pausa para no girar en caliente si la base está caída. La
      // reentrega vuelve al final de la cola; el delivery-limit acota el total.
      await esperar(500);
      try {
        this.canal.nack(mensaje, false, true);
      } catch (errorNack) {
        this.logger.error('no se pudo reencolar el mensaje', {
          eventId,
          ...describirError(errorNack),
        });
      }
    }
  }

  async detener(): Promise<void> {
    if (this.detenido) return;
    this.detenido = true;
    this.logger.info('deteniendo consumidor de uso');
    try {
      await this.canal.close();
    } finally {
      await this.conexion.close();
    }
  }
}

function mensajeDeResultado(resultado: ResultadoRegistroUso): string {
  if (resultado === 'duplicado') return 'uso duplicado confirmado sin efectos';
  if (resultado === 'ignorado') {
    return 'uso de organización eliminada confirmado sin efectos';
  }
  return 'uso aplicado';
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

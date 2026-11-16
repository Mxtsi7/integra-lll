import { readFile } from 'node:fs/promises';
import path from 'node:path';

import amqp, {
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
} from 'amqplib';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProcesadorSuscripcion } from '../../src/aplicacion/procesador-suscripcion';
import { ConsumidorSuscripcion } from '../../src/consumidor/suscripcion.consumer';
import { validarYNormalizarSuscripcion } from '../../src/dominio/validacion-suscripcion';
import { cargarConfig, type Config } from '../../src/infraestructura/config';
import { crearPool } from '../../src/infraestructura/db';
import type { Logger } from '../../src/infraestructura/logger';
import { RepositorioSuscripcionPostgres } from '../../src/infraestructura/repositorio-suscripcion-postgres';

/**
 * S3-VI-10: integración real de la proyección de estado de suscripciones.
 *
 * Usa PostgreSQL y RabbitMQ de verdad. Verifica redelivery, conflicto de
 * `event_id`, aislamiento entre organizaciones, orden temporal y la barrera de
 * borrado de tenant. Se omite salvo `INTEGRACION_USO=1`.
 */

const habilitado = process.env.INTEGRACION_USO === '1';
const suite = habilitado ? describe : describe.skip;

if (process.env.EXIGIR_INTEGRACION_USO === '1' && !habilitado) {
  throw new Error(
    'EXIGIR_INTEGRACION_USO=1 requiere INTEGRACION_USO=1; ' +
      'la suite de integración no puede omitirse',
  );
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '99999999-9999-4999-8999-999999999999';
const ORG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORG_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const SUB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUB_C = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SUB_D = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const EVENTO_1 = '22222222-2222-4222-8222-222222222222';
const EVENTO_2 = '66666666-6666-4666-8666-666666666666';
const EVENTO_3 = '77777777-7777-4777-8777-777777777777';
const EVENTO_TARDIO = 'abababab-cdcd-4efe-8a9b-0c1d2e3f4a5b';
const EVENTO_BORRADO = 'babababa-dcdc-4fef-8b9a-1d2e3f4a5b6c';

const CORRELACION = '4b8e77a2-1c3d-4e5f-8a9b-0c1d2e3f4a5b';

interface RegistroLog {
  readonly nivel: string;
  readonly mensaje: string;
  readonly meta?: Record<string, unknown>;
}

const logs: RegistroLog[] = [];

const logger: Logger = {
  debug: () => undefined,
  info: (mensaje, meta) => logs.push({ nivel: 'info', mensaje, meta }),
  warn: (mensaje, meta) => logs.push({ nivel: 'warn', mensaje, meta }),
  error: (mensaje, meta) => logs.push({ nivel: 'error', mensaje, meta }),
};

interface OpcionesEvento {
  readonly eventId: string;
  readonly organizacionId: string;
  readonly suscripcionId: string;
  readonly ocurridoEn: string;
  readonly estado: 'prueba' | 'activo' | 'por_confirmar' | 'cancelado' | 'fantasma';
  readonly estadoAnterior: string;
  readonly eventoEstado: string;
  readonly monto?: string;
}

function sobreEstado(opciones: OpcionesEvento): Record<string, unknown> {
  return {
    evento: 'suscripcion.estado_cambiado',
    version: 2,
    id: opciones.eventId,
    ocurrido_en: opciones.ocurridoEn,
    correlation_id: CORRELACION,
    organizacion_id: opciones.organizacionId,
    datos: {
      suscripcion_id: opciones.suscripcionId,
      proveedor_id: null,
      nombre: 'Netflix',
      monto: opciones.monto ?? '9990.00',
      moneda: 'CLP',
      ciclo: 'mensual',
      proximo_cobro: '2026-12-01',
      estado: opciones.estado,
      fin_prueba: null,
      estado_anterior: opciones.estadoAnterior,
      evento_estado: opciones.eventoEstado,
    },
  };
}

async function esperar<T>(
  intento: () => Promise<T | undefined>,
  descripcion: string,
  timeoutMs = 20_000,
): Promise<T> {
  const limite = Date.now() + timeoutMs;
  let ultimoError: unknown;

  while (Date.now() < limite) {
    try {
      const valor = await intento();
      if (valor !== undefined) return valor;
    } catch (error) {
      ultimoError = error;
    }
    await new Promise((resolver) => setTimeout(resolver, 100));
  }

  throw new Error(
    `timeout esperando ${descripcion}` +
      (ultimoError ? `: ${String(ultimoError)}` : ''),
  );
}

suite('integración real de suscripcion.estado_cambiado', () => {
  let config: Config;
  let pool: Pool;
  let consumidor: ConsumidorSuscripcion;
  let conexionAdmin: ChannelModel;
  let canalAdmin: Channel;
  let canalPublicacion: ConfirmChannel;

  beforeAll(async () => {
    if (!habilitado) return;

    config = cargarConfig();
    pool = crearPool(config.databaseUrl, 5);

    const sql = await readFile(
      path.resolve(process.cwd(), 'sql', '001_uso_recolectores.sql'),
      'utf8',
    );
    await pool.query(sql);
    await pool.query(
      `TRUNCATE analytics.uso_tramo, analytics.uso_evento,
                analytics.uso_diario, analytics.uso_mensual_recolector,
                analytics.suscripcion_evento, analytics.suscripcion_estado,
                analytics.estado_eliminacion_organizacion`,
    );

    conexionAdmin = await amqp.connect(config.rabbitUrl);
    canalAdmin = await conexionAdmin.createChannel();
    canalPublicacion = await conexionAdmin.createConfirmChannel();
    await canalAdmin.assertExchange(config.exchangeSuscripciones, 'topic', {
      durable: true,
    });

    consumidor = await ConsumidorSuscripcion.crear({
      url: config.rabbitUrl,
      config,
      procesador: new ProcesadorSuscripcion(
        new RepositorioSuscripcionPostgres(pool),
      ),
      logger,
    });
    await canalAdmin.purgeQueue(config.colaSuscripcionEstado);
    await canalAdmin.purgeQueue(config.colaFallosSuscripcionEstado);
    await consumidor.iniciar();
  });

  afterAll(async () => {
    if (!habilitado) return;

    await consumidor?.detener();
    await canalPublicacion?.close();
    await canalAdmin?.close();
    await conexionAdmin?.close();
    await pool?.end();
  });

  async function publicar(sobre: Record<string, unknown>): Promise<void> {
    canalPublicacion.publish(
      config.exchangeSuscripciones,
      config.routingKeySuscripcionEstado,
      Buffer.from(JSON.stringify(sobre), 'utf8'),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: String(sobre.id),
        correlationId: String(sobre.correlation_id),
        type: String(sobre.evento),
        headers: { version: 2 },
      },
    );
    await canalPublicacion.waitForConfirms();
  }

  async function esperarLog(mensaje: string, eventId: string): Promise<void> {
    await esperar(
      async () =>
        logs.some(
          (registro) =>
            registro.mensaje === mensaje && registro.meta?.eventId === eventId,
        )
          ? true
          : undefined,
      `log "${mensaje}" para ${eventId}`,
    );
  }

  async function leerEstado(
    organizacionId: string,
    suscripcionId: string,
  ): Promise<
    | {
        estado: string;
        monto: string;
        moneda: string;
        estado_anterior: string;
        evento_estado: string;
        event_id: string;
        ocurrido_en: string;
      }
    | undefined
  > {
    const resultado = await pool.query<{
      estado: string;
      monto: string;
      moneda: string;
      estado_anterior: string;
      evento_estado: string;
      event_id: string;
      ocurrido_en: string;
    }>(
      `
        SELECT estado, monto::text, moneda, estado_anterior, evento_estado,
               event_id::text, ocurrido_en::text
        FROM analytics.suscripcion_estado
        WHERE organizacion_id = $1 AND suscripcion_id = $2
      `,
      [organizacionId, suscripcionId],
    );
    return resultado.rows[0];
  }

  async function contarInbox(organizacionId: string): Promise<number> {
    const resultado = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total
       FROM analytics.suscripcion_evento
       WHERE organizacion_id = $1`,
      [organizacionId],
    );
    return Number(resultado.rows[0]?.total ?? '0');
  }

  async function marcarEliminada(
    organizacionId: string,
    eliminada: boolean,
  ): Promise<void> {
    await pool.query(
      `
        INSERT INTO analytics.estado_eliminacion_organizacion (
          organizacion_id, eliminada
        ) VALUES ($1, $2)
        ON CONFLICT (organizacion_id)
        DO UPDATE SET eliminada = EXCLUDED.eliminada
      `,
      [organizacionId, eliminada],
    );
  }

  function normalizado(opciones: OpcionesEvento) {
    return validarYNormalizarSuscripcion(sobreEstado(opciones));
  }

  it('proyecta el estado y confirma una reentrega sin repetir efectos', async () => {
    const sobre = sobreEstado({
      eventId: EVENTO_1,
      organizacionId: ORG_A,
      suscripcionId: SUB_A,
      ocurridoEn: '2026-11-09T12:02:01.123Z',
      estado: 'activo',
      estadoAnterior: 'prueba',
      eventoEstado: 'fin_prueba',
    });

    await publicar(sobre);

    const estado = await esperar(
      async () => {
        const fila = await leerEstado(ORG_A, SUB_A);
        return fila?.event_id === EVENTO_1 ? fila : undefined;
      },
      'el estado vigente de la organización A',
    );
    expect(estado.estado).toBe('activo');
    expect(estado.monto).toBe('9990.00');
    expect(estado.moneda).toBe('CLP');
    expect(estado.estado_anterior).toBe('prueba');
    expect(estado.evento_estado).toBe('fin_prueba');
    expect(await contarInbox(ORG_A)).toBe(1);

    // La misma entrega: el inbox la reconoce y no hay segunda escritura.
    await publicar(sobre);
    await esperarLog(
      'proyección de suscripción duplicada confirmada sin efectos',
      EVENTO_1,
    );
    expect(await contarInbox(ORG_A)).toBe(1);
    expect((await leerEstado(ORG_A, SUB_A))?.event_id).toBe(EVENTO_1);
  });

  it('rechaza a la cola de fallos un event_id reutilizado con otro contenido', async () => {
    const fallosAntes = (await canalAdmin.checkQueue(
      config.colaFallosSuscripcionEstado,
    )).messageCount;

    await publicar(
      sobreEstado({
        eventId: EVENTO_1,
        organizacionId: ORG_A,
        suscripcionId: SUB_A,
        ocurridoEn: '2026-11-09T12:02:01.123Z',
        estado: 'activo',
        estadoAnterior: 'prueba',
        eventoEstado: 'fin_prueba',
        monto: '12990.00',
      }),
    );

    await esperarLog(
      'suscripción rechazada sin reintento; se envía a la cola de fallos',
      EVENTO_1,
    );
    await esperar(async () => {
      const cola = await canalAdmin.checkQueue(
        config.colaFallosSuscripcionEstado,
      );
      return cola.messageCount > fallosAntes ? cola.messageCount : undefined;
    }, 'el mensaje conflictivo en la cola de fallos');

    expect(await contarInbox(ORG_A)).toBe(1);
    const estado = await leerEstado(ORG_A, SUB_A);
    expect(estado?.monto).toBe('9990.00');
    expect(estado?.event_id).toBe(EVENTO_1);
  });

  it('aísla organizaciones aunque el event_id coincida', async () => {
    await publicar(
      sobreEstado({
        eventId: EVENTO_1,
        organizacionId: ORG_B,
        suscripcionId: SUB_B,
        ocurridoEn: '2026-11-09T12:02:01.123Z',
        estado: 'activo',
        estadoAnterior: 'prueba',
        eventoEstado: 'fin_prueba',
      }),
    );

    const estadoB = await esperar(
      async () => {
        const fila = await leerEstado(ORG_B, SUB_B);
        return fila?.event_id === EVENTO_1 ? fila : undefined;
      },
      'el estado vigente de la organización B',
    );
    expect(estadoB.estado).toBe('activo');
    expect(await contarInbox(ORG_B)).toBe(1);

    // El tenant A conserva su propio hecho y su propio monto.
    expect(await contarInbox(ORG_A)).toBe(1);
    expect((await leerEstado(ORG_A, SUB_A))?.monto).toBe('9990.00');
  });

  it('registra un evento atrasado sin retroceder el estado vigente', async () => {
    await publicar(
      sobreEstado({
        eventId: EVENTO_2,
        organizacionId: ORG_A,
        suscripcionId: SUB_A,
        ocurridoEn: '2026-11-10T10:00:00.000Z',
        estado: 'cancelado',
        estadoAnterior: 'activo',
        eventoEstado: 'cancelacion_usuario',
      }),
    );
    await esperar(
      async () => {
        const fila = await leerEstado(ORG_A, SUB_A);
        return fila?.event_id === EVENTO_2 ? fila : undefined;
      },
      'la cancelación vigente de la organización A',
    );

    await publicar(
      sobreEstado({
        eventId: EVENTO_3,
        organizacionId: ORG_A,
        suscripcionId: SUB_A,
        ocurridoEn: '2026-11-09T13:00:00.000Z',
        estado: 'activo',
        estadoAnterior: 'prueba',
        eventoEstado: 'fin_prueba',
      }),
    );

    await esperarLog(
      'suscripción obsoleta confirmada sin efectos',
      EVENTO_3,
    );
    expect(await contarInbox(ORG_A)).toBe(3);
    const estado = await leerEstado(ORG_A, SUB_A);
    expect(estado?.estado).toBe('cancelado');
    expect(estado?.event_id).toBe(EVENTO_2);
  });

  it('descarta sin DLQ un evento de una organización eliminada', async () => {
    await marcarEliminada(ORG_C, true);
    const fallosAntes = (await canalAdmin.checkQueue(
      config.colaFallosSuscripcionEstado,
    )).messageCount;

    await publicar(
      sobreEstado({
        eventId: EVENTO_BORRADO,
        organizacionId: ORG_C,
        suscripcionId: SUB_C,
        ocurridoEn: '2026-11-09T12:02:01.123Z',
        estado: 'activo',
        estadoAnterior: 'prueba',
        eventoEstado: 'fin_prueba',
      }),
    );

    await esperarLog(
      'suscripción de organización eliminada confirmada sin efectos',
      EVENTO_BORRADO,
    );
    expect(await contarInbox(ORG_C)).toBe(0);
    expect(await leerEstado(ORG_C, SUB_C)).toBeUndefined();
    expect(
      (await canalAdmin.checkQueue(config.colaFallosSuscripcionEstado))
        .messageCount,
    ).toBe(fallosAntes);
  });

  it('espera el bloqueo de limpieza y no deja que el estado reaparezca', async () => {
    const repositorio = new RepositorioSuscripcionPostgres(pool);
    await marcarEliminada(ORG_D, false);

    expect(
      await repositorio.registrar(
        normalizado({
          eventId: EVENTO_1,
          organizacionId: ORG_D,
          suscripcionId: SUB_D,
          ocurridoEn: '2026-11-09T12:02:01.123Z',
          estado: 'activo',
          estadoAnterior: 'prueba',
          eventoEstado: 'fin_prueba',
        }),
      ),
    ).toBe('aplicado');
    expect(await contarInbox(ORG_D)).toBe(1);

    // La limpieza toma la barrera exclusiva y borra las tablas nuevas, igual
    // que `LimpiezaAnalyticsView`, pero se detiene antes del COMMIT.
    const limpieza = await pool.connect();
    let confirmada = false;
    try {
      await limpieza.query('BEGIN');
      await limpieza.query(
        `
          SELECT 1
          FROM analytics.estado_eliminacion_organizacion
          WHERE organizacion_id = $1
          FOR UPDATE
        `,
        [ORG_D],
      );
      await limpieza.query(
        `
          UPDATE analytics.estado_eliminacion_organizacion
          SET eliminada = true
          WHERE organizacion_id = $1
        `,
        [ORG_D],
      );
      for (const tabla of [
        'suscripcion_evento',
        'suscripcion_estado',
      ] as const) {
        await limpieza.query(
          `DELETE FROM analytics.${tabla} WHERE organizacion_id = $1`,
          [ORG_D],
        );
      }

      const enVuelo = repositorio.registrar(
        normalizado({
          eventId: EVENTO_TARDIO,
          organizacionId: ORG_D,
          suscripcionId: SUB_D,
          ocurridoEn: '2026-11-10T12:02:01.123Z',
          estado: 'cancelado',
          estadoAnterior: 'activo',
          eventoEstado: 'cancelacion_usuario',
        }),
      );

      await esperar(
        async () => {
          const esperando = await pool.query<{ total: number }>(
            `
              SELECT count(*)::int AS total
              FROM pg_stat_activity
              WHERE application_name = 'analytics-uso'
                AND wait_event_type = 'Lock'
            `,
          );
          return (esperando.rows[0]?.total ?? 0) >= 1 ? true : undefined;
        },
        'el evento tardío esperando el bloqueo exclusivo de la limpieza',
      );

      // Mientras la limpieza no confirma, el hecho viejo sigue visible y el
      // tardío no insertó una segunda fila.
      expect(await contarInbox(ORG_D)).toBe(1);

      await limpieza.query('COMMIT');
      confirmada = true;

      expect(await enVuelo).toBe('ignorado');
      expect(await contarInbox(ORG_D)).toBe(0);
      expect(await leerEstado(ORG_D, SUB_D)).toBeUndefined();
    } finally {
      if (!confirmada) {
        await limpieza.query('ROLLBACK').catch(() => undefined);
      }
      limpieza.release();
    }
  });
});

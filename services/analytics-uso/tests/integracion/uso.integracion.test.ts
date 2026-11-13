import { readFile } from 'node:fs/promises';
import path from 'node:path';

import amqp, { type Channel, type ChannelModel } from 'amqplib';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProcesadorUso } from '../../src/aplicacion/procesador-uso';
import { ConsumidorUso } from '../../src/consumidor/uso.consumer';
import type { UsageEventPayload } from '../../src/dominio/uso-recolectores.dto';
import { crearEventoUsoRegistrado } from '../../src/dominio/uso-registrado.event';
import { validarYNormalizar } from '../../src/dominio/validacion';
import { cargarConfig, type Config } from '../../src/infraestructura/config';
import { crearPool } from '../../src/infraestructura/db';
import type { Logger } from '../../src/infraestructura/logger';
import { RepositorioUsoPostgres } from '../../src/infraestructura/repositorio-uso-postgres';
import { declararTopologia } from '../../src/infraestructura/topologia';
import { PublicadorUso } from '../../src/publicador/uso.publisher';

/**
 * Integración real del pipeline de uso: PostgreSQL + RabbitMQ de verdad.
 *
 * No usa mocks ni el repositorio en memoria. Publica por el exchange dedicado,
 * deja que el worker consuma y verifica los agregados en las tablas `uso_*`.
 *
 * Se omite salvo que `INTEGRACION_USO=1`. Ver el README del servicio y
 * `docker-compose.analytics-uso-test.yml`.
 */

const habilitado = process.env.INTEGRACION_USO === '1';
const suite = habilitado ? describe : describe.skip;

// En CI la integración no puede pasar por omisión: si alguien quita la
// variable, el job falla en vez de mostrar una suite verde sin haber tocado
// PostgreSQL ni RabbitMQ.
if (process.env.EXIGIR_INTEGRACION_USO === '1' && !habilitado) {
  throw new Error(
    'EXIGIR_INTEGRACION_USO=1 requiere INTEGRACION_USO=1; ' +
      'la suite de integración no puede omitirse',
  );
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '99999999-9999-4999-8999-999999999999';
const SUB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USUARIO = '5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d';
const REC_ANDROID = '33333333-3333-4333-8333-333333333333';
const REC_NAVEGADOR = '44444444-4444-4444-8444-444444444444';
const REC_TERCERO = '55555555-5555-4555-8555-555555555555';

const EVENTO_A = '22222222-2222-4222-8222-222222222222';
const EVENTO_B = '66666666-6666-4666-8666-666666666666';
const EVENTO_C = '77777777-7777-4777-8777-777777777777';

const ORG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORG_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUB_C = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SUB_D = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const EVENTO_BORRADO = 'abababab-cdcd-4efe-8a9b-0c1d2e3f4a5b';
const EVENTO_TARDIO = 'babababa-dcdc-4fef-8b9a-1d2e3f4a5b6c';

const FECHA_LOCAL = '2026-11-09';

// Tablas propias del consumidor, en orden hijo/padre para borrarlas.
const TABLAS_USO = [
  'uso_tramo',
  'uso_evento',
  'uso_diario',
  'uso_mensual',
] as const;

// America/Santiago en noviembre es UTC-3: 12:00Z es media mañana del mismo día
// local. La ventana y todos los tramos caben en 2026-11-09.
const A = {
  inicio: '2026-11-09T12:00:00Z',
  fin: '2026-11-09T12:05:00Z',
  tramos: [
    { inicio: '2026-11-09T12:00:00Z', fin: '2026-11-09T12:02:00Z' },
    { inicio: '2026-11-09T12:03:00Z', fin: '2026-11-09T12:03:30Z' },
  ],
} as const;

const B = {
  inicio: '2026-11-09T12:01:00Z',
  fin: '2026-11-09T12:04:00Z',
  tramos: [
    { inicio: '2026-11-09T12:01:00Z', fin: '2026-11-09T12:03:00Z' },
    { inicio: '2026-11-09T12:03:30Z', fin: '2026-11-09T12:04:00Z' },
  ],
} as const;

const C = {
  inicio: '2026-11-09T12:10:00Z',
  fin: '2026-11-09T12:10:30Z',
  tramos: [{ inicio: '2026-11-09T12:10:00Z', fin: '2026-11-09T12:10:30Z' }],
} as const;

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

function payload(
  eventId: string,
  recolectorId: string,
  origen: 'android' | 'navegador',
  ventana: { readonly inicio: string; readonly fin: string; readonly tramos: readonly { readonly inicio: string; readonly fin: string }[] },
): UsageEventPayload {
  const duracionMs = ventana.tramos.reduce(
    (total, tramo) => total + (Date.parse(tramo.fin) - Date.parse(tramo.inicio)),
    0,
  );

  return {
    version: 1,
    event_id: eventId,
    recolector_id: recolectorId,
    origen,
    inicio: ventana.inicio,
    fin: ventana.fin,
    duracion_ms: duracionMs,
    tramos_actividad: ventana.tramos.map((tramo) => ({ ...tramo })),
    zona_horaria: 'America/Santiago',
    cobertura: 'completa',
    estado: 'activo',
  };
}

const EVENTO_PAYLOAD_A = payload(EVENTO_A, REC_ANDROID, 'android', A);
const EVENTO_PAYLOAD_B = payload(EVENTO_B, REC_NAVEGADOR, 'navegador', B);
const EVENTO_PAYLOAD_C = payload(EVENTO_C, REC_TERCERO, 'android', C);

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

suite('integración real del pipeline de uso', () => {
  let config: Config;
  let pool: Pool;
  let consumidor: ConsumidorUso;
  let publicador: PublicadorUso;
  let conexionAdmin: ChannelModel;
  let canalAdmin: Channel;

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
                analytics.uso_diario, analytics.uso_mensual,
                analytics.estado_eliminacion_organizacion`,
    );

    conexionAdmin = await amqp.connect(config.rabbitUrl);
    canalAdmin = await conexionAdmin.createChannel();
    await declararTopologia(canalAdmin, config);
    await canalAdmin.purgeQueue(config.colaUso);
    await canalAdmin.purgeQueue(config.colaFallos);

    consumidor = await ConsumidorUso.crear({
      url: config.rabbitUrl,
      config,
      procesador: new ProcesadorUso(new RepositorioUsoPostgres(pool)),
      logger,
    });
    await consumidor.iniciar();

    publicador = await PublicadorUso.crear({
      url: config.rabbitUrl,
      exchangeUso: config.exchangeUso,
      routingKeyUso: config.routingKeyUso,
      logger,
    });
  });

  afterAll(async () => {
    if (!habilitado) return;

    await consumidor?.detener();
    await publicador?.cerrar();
    await canalAdmin?.close();
    await conexionAdmin?.close();
    await pool?.end();
  });

  async function publicar(
    eventId: string,
    body: UsageEventPayload,
    organizacionId: string,
    suscripcionId: string,
  ): Promise<void> {
    const evento = crearEventoUsoRegistrado(body, {
      organizacionId,
      suscripcionId,
      usuarioId: USUARIO,
    });
    await publicador.publicar(evento);
  }

  function eventoDe(
    eventId: string,
    organizacionId: string,
    suscripcionId: string,
    ventana: {
      readonly inicio: string;
      readonly fin: string;
      readonly tramos: readonly { readonly inicio: string; readonly fin: string }[];
    },
  ) {
    return validarYNormalizar(
      crearEventoUsoRegistrado(payload(eventId, REC_ANDROID, 'android', ventana), {
        organizacionId,
        suscripcionId,
        usuarioId: USUARIO,
      }),
    );
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

  async function leerDiario(
    organizacionId: string,
    suscripcionId: string,
  ): Promise<
    | { ms_netos: string; minutos_netos: string; ms_residuo: number }
    | undefined
  > {
    const resultado = await pool.query<{
      ms_netos: string;
      minutos_netos: string;
      ms_residuo: number;
    }>(
      `
        SELECT ms_netos::text, minutos_netos::text, ms_residuo
        FROM analytics.uso_diario
        WHERE organizacion_id = $1
          AND suscripcion_id = $2
          AND fecha_local = $3::date
      `,
      [organizacionId, suscripcionId, FECHA_LOCAL],
    );
    return resultado.rows[0];
  }

  async function leerMensual(
    organizacionId: string,
    suscripcionId: string,
  ): Promise<
    { ms_netos: string; minutos_netos: string } | undefined
  > {
    const resultado = await pool.query<{
      ms_netos: string;
      minutos_netos: string;
    }>(
      `
        SELECT ms_netos::text, minutos_netos::text
        FROM analytics.uso_mensual
        WHERE organizacion_id = $1
          AND suscripcion_id = $2
          AND anio = 2026
          AND mes = 11
      `,
      [organizacionId, suscripcionId],
    );
    return resultado.rows[0];
  }

  async function contarEventos(organizacionId: string): Promise<number> {
    const resultado = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM analytics.uso_evento WHERE organizacion_id = $1',
      [organizacionId],
    );
    return Number(resultado.rows[0]?.total ?? '0');
  }

  async function contarTramos(organizacionId: string): Promise<number> {
    const resultado = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM analytics.uso_tramo WHERE organizacion_id = $1',
      [organizacionId],
    );
    return Number(resultado.rows[0]?.total ?? '0');
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

  it('publica, consume y agrega la unión de tramos con solapamiento', async () => {
    await publicar(EVENTO_A, EVENTO_PAYLOAD_A, ORG_A, SUB_A);
    await publicar(EVENTO_B, EVENTO_PAYLOAD_B, ORG_A, SUB_A);
    await publicar(EVENTO_C, EVENTO_PAYLOAD_C, ORG_A, SUB_A);

    // Aportes: A = 150 s, B = 150 s, C = 30 s. Suma bruta = 330 s.
    // Unión real: [12:00, 12:04) + [12:10, 12:10:30) = 270 s = 4 min 30 s.
    //
    // La fila diaria existe desde el primer evento: esperar solo a que exista
    // leería un agregado intermedio. Hay que esperar al valor final.
    const diario = await esperar(
      async () => {
        const fila = await leerDiario(ORG_A, SUB_A);
        return fila?.ms_netos === '270000' ? fila : undefined;
      },
      'el agregado diario final de la organización A',
    );

    expect(diario.ms_netos).toBe('270000');
    expect(diario.minutos_netos).toBe('4');
    expect(diario.ms_residuo).toBe(30_000);

    const mensual = await esperar(
      async () => {
        const fila = await leerMensual(ORG_A, SUB_A);
        return fila?.ms_netos === '270000' ? fila : undefined;
      },
      'el agregado mensual final de la organización A',
    );
    expect(mensual.ms_netos).toBe('270000');
    expect(mensual.minutos_netos).toBe('4');

    expect(await contarEventos(ORG_A)).toBe(3);
    expect(await contarTramos(ORG_A)).toBe(5);
  });

  it('confirma un duplicado sin repetir efectos', async () => {
    await publicar(EVENTO_A, EVENTO_PAYLOAD_A, ORG_A, SUB_A);

    await esperarLog('uso duplicado confirmado sin efectos', EVENTO_A);

    expect(await contarEventos(ORG_A)).toBe(3);

    const diario = await leerDiario(ORG_A, SUB_A);
    expect(diario?.ms_netos).toBe('270000');
    expect(diario?.minutos_netos).toBe('4');
    expect(diario?.ms_residuo).toBe(30_000);
  });

  it('rechaza a la cola de fallos un event_id reutilizado con otro contenido', async () => {
    // Misma clave (organización, recolector, event_id) que A, pero otro
    // contenido. Es un conflicto, no un duplicado: debe ir a la DLQ.
    const conflictivo = payload(EVENTO_A, REC_ANDROID, 'android', {
      inicio: '2026-11-09T12:00:00Z',
      fin: '2026-11-09T12:05:00Z',
      tramos: [
        { inicio: '2026-11-09T12:00:00Z', fin: '2026-11-09T12:01:00Z' },
      ],
    });

    await publicar(EVENTO_A, conflictivo, ORG_A, SUB_A);

    await esperarLog(
      'uso rechazado sin reintento; se envía a la cola de fallos',
      EVENTO_A,
    );
    await esperar(async () => {
      const cola = await canalAdmin.checkQueue(config.colaFallos);
      return cola.messageCount >= 1 ? cola.messageCount : undefined;
    }, 'un mensaje en la cola de fallos');

    // El hecho original no cambia y no se duplican tramos.
    expect(await contarEventos(ORG_A)).toBe(3);
    expect(await contarTramos(ORG_A)).toBe(5);

    const diario = await leerDiario(ORG_A, SUB_A);
    expect(diario?.ms_netos).toBe('270000');
    expect(diario?.minutos_netos).toBe('4');
  });

  it('acepta el mismo event_id en otra organización (clave con tenant)', async () => {
    await publicar(EVENTO_A, EVENTO_PAYLOAD_A, ORG_B, SUB_B);

    const diario = await esperar(
      () => leerDiario(ORG_B, SUB_B),
      'el agregado diario de la organización B',
    );

    // Solo el evento A en el tenant B: 150 s = 2 min 30 s.
    expect(diario.ms_netos).toBe('150000');
    expect(diario.minutos_netos).toBe('2');
    expect(diario.ms_residuo).toBe(30_000);

    const mensual = await esperar(
      () => leerMensual(ORG_B, SUB_B),
      'el agregado mensual de la organización B',
    );
    expect(mensual.ms_netos).toBe('150000');
    expect(mensual.minutos_netos).toBe('2');

    expect(await contarEventos(ORG_B)).toBe(1);
    // El tenant A conserva exactamente sus tres hechos.
    expect(await contarEventos(ORG_A)).toBe(3);

    const diarioA = await leerDiario(ORG_A, SUB_A);
    expect(diarioA?.ms_netos).toBe('270000');
  });

  it('ignora un evento tardío de una organización eliminada sin reinsertar', async () => {
    const repositorio = new RepositorioUsoPostgres(pool);
    await marcarEliminada(ORG_C, true);

    const resultado = await repositorio.registrar(
      eventoDe(EVENTO_BORRADO, ORG_C, SUB_C, A),
    );

    // La limpieza ya confirmó: el mensaje se ACK sin efectos y no va a la DLQ.
    expect(resultado).toBe('ignorado');
    expect(await contarEventos(ORG_C)).toBe(0);
    expect(await contarTramos(ORG_C)).toBe(0);
    expect(await leerDiario(ORG_C, SUB_C)).toBeUndefined();
    expect(await leerMensual(ORG_C, SUB_C)).toBeUndefined();
  });

  it('confirma por el broker un evento de tenant eliminado sin enviarlo a fallos', async () => {
    const fallosAntes = (await canalAdmin.checkQueue(config.colaFallos))
      .messageCount;

    // Pasa por el worker real: el ACK del resultado `ignorado` es lo que
    // evita que una reentrega tardía termine en la DLQ.
    await publicar(
      EVENTO_TARDIO,
      payload(EVENTO_TARDIO, REC_ANDROID, 'android', C),
      ORG_C,
      SUB_C,
    );
    await esperarLog(
      'uso de organización eliminada confirmado sin efectos',
      EVENTO_TARDIO,
    );

    expect(await contarEventos(ORG_C)).toBe(0);
    expect(await contarTramos(ORG_C)).toBe(0);
    expect((await canalAdmin.checkQueue(config.colaFallos)).messageCount).toBe(
      fallosAntes,
    );
  });

  it('espera el bloqueo de limpieza y no deja que las filas reaparezcan', async () => {
    const repositorio = new RepositorioUsoPostgres(pool);
    await marcarEliminada(ORG_D, false);

    expect(
      await repositorio.registrar(eventoDe(EVENTO_BORRADO, ORG_D, SUB_D, A)),
    ).toBe('aplicado');
    expect(await contarEventos(ORG_D)).toBe(1);

    // La limpieza toma la barrera exclusiva y borra las cuatro tablas, igual
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
      for (const tabla of TABLAS_USO) {
        await limpieza.query(
          `DELETE FROM analytics.${tabla} WHERE organizacion_id = $1`,
          [ORG_D],
        );
      }

      const enVuelo = repositorio.registrar(
        eventoDe(EVENTO_TARDIO, ORG_D, SUB_D, C),
      );

      // El evento tardío quedó esperando la barrera: todavía no insertó nada.
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

      // Mientras la limpieza no confirma, el evento viejo sigue visible y el
      // tardío no agregó una segunda fila.
      expect(await contarEventos(ORG_D)).toBe(1);

      await limpieza.query('COMMIT');
      confirmada = true;

      expect(await enVuelo).toBe('ignorado');
      expect(await contarEventos(ORG_D)).toBe(0);
      expect(await contarTramos(ORG_D)).toBe(0);
      expect(await leerDiario(ORG_D, SUB_D)).toBeUndefined();
      expect(await leerMensual(ORG_D, SUB_D)).toBeUndefined();
    } finally {
      if (!confirmada) {
        await limpieza.query('ROLLBACK').catch(() => undefined);
      }
      limpieza.release();
    }
  });
});

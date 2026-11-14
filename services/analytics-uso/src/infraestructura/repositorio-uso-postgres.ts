import type { Pool, PoolClient } from 'pg';

import type {
  RepositorioUso,
  ResultadoRegistroUso,
} from '../aplicacion/repositorio-uso';
import { proyectarMinutos } from '../dominio/agregados';
import { ErrorConflictoEvento } from '../dominio/errores';
import { duracionUnionMs } from '../dominio/intervalos';
import type { EventoUsoNormalizado } from '../dominio/uso-recolectores.dto';
import { bloquearOrganizacionCompartido } from './bloqueo-tenant';

/**
 * S3-VI-11/S3-VI-12/S3-VI-14: persistencia transaccional e idempotente.
 *
 * Una transacción hace todo o nada:
 *   0. toma la barrera compartida del tenant y aborta si está eliminado;
 *   1. inserta el evento con `ON CONFLICT DO NOTHING` sobre la clave
 *      `(organizacion_id, recolector_id, event_id)`;
 *   2. si ya existía, compara la huella del contenido + destino: igual es
 *      duplicado, distinto es conflicto;
 *   3. inserta los tramos exactos del evento;
 *   4. bloquea la fila diaria y recalcula la unión de todos los tramos del día;
 *   5. bloquea la fila mensual y recalcula desde los días, sumando minutos
 *      enteros ya proyectados.
 *
 * El bloqueo diario serializa eventos del mismo día; el mensual se toma
 * después para que dos días del mismo mes no se pisen con una suma obsoleta.
 * La barrera del paso 0 es la misma que usa la limpieza de `shared/borrado`:
 * un evento tardío espera al borrado y, al ver el tenant eliminado, no
 * reinserta nada y se confirma sin efectos (`ignorado`).
 */
export class RepositorioUsoPostgres implements RepositorioUso {
  constructor(private readonly pool: Pool) {}

  async registrar(evento: EventoUsoNormalizado): Promise<ResultadoRegistroUso> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');

      // Antes de cualquier INSERT/UPSERT en `uso_*`: serializa con la limpieza
      // y lee el estado bajo el lock compartido.
      const estado = await bloquearOrganizacionCompartido(
        cliente,
        evento.organizacionId,
      );
      if (estado.eliminada) {
        await cliente.query('COMMIT');
        return 'ignorado';
      }

      const insertado = await this.insertarEvento(cliente, evento);
      if (!insertado) {
        return await this.resolverDuplicado(cliente, evento);
      }

      await this.insertarTramos(cliente, evento);
      await this.recalcularDiario(cliente, evento);
      await this.recalcularMensual(cliente, evento);

      await cliente.query('COMMIT');
      return 'aplicado';
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  private async insertarEvento(
    cliente: PoolClient,
    evento: EventoUsoNormalizado,
  ): Promise<boolean> {
    const tramosJson = JSON.stringify(
      evento.tramos.map((tramo) => ({
        inicio: tramo.inicio.toISOString(),
        fin: tramo.fin.toISOString(),
      })),
    );

    const resultado = await cliente.query<{ event_id: string }>(
      `
        INSERT INTO analytics.uso_evento (
          organizacion_id, recolector_id, event_id, suscripcion_id, usuario_id,
          origen, inicio, fin, duracion_ms, tramos_actividad, zona_horaria,
          cobertura, estado, fecha_local, huella, ocurrido_en, correlation_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10::jsonb, $11,
          $12, $13, $14::date, $15, $16, $17
        )
        ON CONFLICT (organizacion_id, recolector_id, event_id) DO NOTHING
        RETURNING event_id
      `,
      [
        evento.organizacionId,
        evento.recolectorId,
        evento.eventId,
        evento.suscripcionId,
        evento.usuarioId,
        evento.origen,
        evento.inicio,
        evento.fin,
        evento.duracionMs,
        tramosJson,
        evento.zonaHoraria,
        evento.cobertura,
        evento.estado,
        evento.fechaLocal,
        evento.huella,
        evento.ocurridoEn,
        evento.correlationId,
      ],
    );

    return resultado.rows.length > 0;
  }

  private async resolverDuplicado(
    cliente: PoolClient,
    evento: EventoUsoNormalizado,
  ): Promise<ResultadoRegistroUso> {
    const existente = await cliente.query<{
      huella: string;
      suscripcion_id: string;
    }>(
      `
        SELECT huella, suscripcion_id
        FROM analytics.uso_evento
        WHERE organizacion_id = $1
          AND recolector_id = $2
          AND event_id = $3
      `,
      [evento.organizacionId, evento.recolectorId, evento.eventId],
    );

    const fila = existente.rows[0];
    if (!fila) {
      // Otra transacción borró la fila entre el conflicto y esta lectura.
      throw new ErrorConflictoEvento(
        'la clave del evento quedó en conflicto sin una fila visible; se reintenta la lectura',
      );
    }

    if (fila.huella === evento.huella && fila.suscripcion_id === evento.suscripcionId) {
      // Sin efectos nuevos. El ACK del consumidor es la confirmación.
      await cliente.query('COMMIT');
      return 'duplicado';
    }

    throw new ErrorConflictoEvento(
      'el event_id ya fue aceptado con otro contenido o destino',
    );
  }

  private async insertarTramos(
    cliente: PoolClient,
    evento: EventoUsoNormalizado,
  ): Promise<void> {
    const TAMANO_LOTE = 500;
    for (let inicio = 0; inicio < evento.tramos.length; inicio += TAMANO_LOTE) {
      const lote = evento.tramos.slice(inicio, inicio + TAMANO_LOTE);
      const valores: unknown[] = [];
      const marcadores = lote.map((tramo, indice) => {
        const base = indice * 6;
        valores.push(
          evento.organizacionId,
          evento.recolectorId,
          evento.eventId,
          inicio + indice,
          tramo.inicio,
          tramo.fin,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      });

      await cliente.query(
        `
          INSERT INTO analytics.uso_tramo (
            organizacion_id, recolector_id, event_id, indice, inicio, fin
          ) VALUES ${marcadores.join(', ')}
        `,
        valores,
      );
    }
  }

  private async recalcularDiario(
    cliente: PoolClient,
    evento: EventoUsoNormalizado,
  ): Promise<void> {
    // Crea la fila si no existe y luego la bloquea. Dos eventos del mismo día
    // se serializan aquí, de modo que la segunda lectura ve el primer evento.
    await cliente.query(
      `
        INSERT INTO analytics.uso_diario (
          organizacion_id, suscripcion_id, fecha_local,
          ms_netos, minutos_netos, ms_residuo, actualizado_en
        ) VALUES ($1, $2, $3::date, 0, 0, 0, now())
        ON CONFLICT (organizacion_id, suscripcion_id, fecha_local) DO NOTHING
      `,
      [evento.organizacionId, evento.suscripcionId, evento.fechaLocal],
    );

    await cliente.query(
      `
        SELECT 1
        FROM analytics.uso_diario
        WHERE organizacion_id = $1
          AND suscripcion_id = $2
          AND fecha_local = $3::date
        FOR UPDATE
      `,
      [evento.organizacionId, evento.suscripcionId, evento.fechaLocal],
    );

    const tramos = await cliente.query<{ inicio: Date; fin: Date }>(
      `
        SELECT t.inicio, t.fin
        FROM analytics.uso_tramo t
        JOIN analytics.uso_evento e
          ON e.organizacion_id = t.organizacion_id
         AND e.recolector_id = t.recolector_id
         AND e.event_id = t.event_id
        WHERE e.organizacion_id = $1
          AND e.suscripcion_id = $2
          AND e.fecha_local = $3::date
      `,
      [evento.organizacionId, evento.suscripcionId, evento.fechaLocal],
    );

    const msNetos = duracionUnionMs(
      tramos.rows.map((tramo) => ({
        inicio: tramo.inicio.getTime(),
        fin: tramo.fin.getTime(),
      })),
    );
    const proyeccion = proyectarMinutos(msNetos);

    await cliente.query(
      `
        UPDATE analytics.uso_diario
        SET ms_netos = $4,
            minutos_netos = $5,
            ms_residuo = $6,
            actualizado_en = now()
        WHERE organizacion_id = $1
          AND suscripcion_id = $2
          AND fecha_local = $3::date
      `,
      [
        evento.organizacionId,
        evento.suscripcionId,
        evento.fechaLocal,
        proyeccion.msNetos,
        proyeccion.minutosNetos,
        proyeccion.msResiduo,
      ],
    );
  }

  private async recalcularMensual(
    cliente: PoolClient,
    evento: EventoUsoNormalizado,
  ): Promise<void> {
    const anio = Number(evento.fechaLocal.slice(0, 4));
    const mes = Number(evento.fechaLocal.slice(5, 7));

    await cliente.query(
      `
        INSERT INTO analytics.uso_mensual_recolector (
          organizacion_id, suscripcion_id, anio, mes,
          minutos_netos, ms_netos, actualizado_en
        ) VALUES ($1, $2, $3, $4, 0, 0, now())
        ON CONFLICT (organizacion_id, suscripcion_id, anio, mes) DO NOTHING
      `,
      [evento.organizacionId, evento.suscripcionId, anio, mes],
    );

    await cliente.query(
      `
        SELECT 1
        FROM analytics.uso_mensual_recolector
        WHERE organizacion_id = $1
          AND suscripcion_id = $2
          AND anio = $3
          AND mes = $4
        FOR UPDATE
      `,
      [evento.organizacionId, evento.suscripcionId, anio, mes],
    );

    // Suma los minutos enteros de cada día, no la división de la suma de ms:
    // un residuo diario no se convierte en un minuto mensual artificial.
    await cliente.query(
      `
        UPDATE analytics.uso_mensual_recolector m
        SET minutos_netos = (
              SELECT COALESCE(SUM(d.minutos_netos), 0)
              FROM analytics.uso_diario d
              WHERE d.organizacion_id = m.organizacion_id
                AND d.suscripcion_id = m.suscripcion_id
                AND EXTRACT(YEAR FROM d.fecha_local) = m.anio
                AND EXTRACT(MONTH FROM d.fecha_local) = m.mes
            ),
            ms_netos = (
              SELECT COALESCE(SUM(d.ms_netos), 0)
              FROM analytics.uso_diario d
              WHERE d.organizacion_id = m.organizacion_id
                AND d.suscripcion_id = m.suscripcion_id
                AND EXTRACT(YEAR FROM d.fecha_local) = m.anio
                AND EXTRACT(MONTH FROM d.fecha_local) = m.mes
            ),
            actualizado_en = now()
        WHERE m.organizacion_id = $1
          AND m.suscripcion_id = $2
          AND m.anio = $3
          AND m.mes = $4
      `,
      [evento.organizacionId, evento.suscripcionId, anio, mes],
    );
  }
}

import type { Pool, PoolClient } from 'pg';

import type {
  RepositorioSuscripcion,
  ResultadoProyeccionSuscripcion,
} from '../aplicacion/repositorio-suscripcion';
import { ErrorConflictoSuscripcion } from '../dominio/errores';
import type { EventoSuscripcionEstadoNormalizado } from '../dominio/suscripcion-estado.dto';
import { bloquearOrganizacionCompartido } from './bloqueo-tenant';

/**
 * Proyección transaccional de `suscripcion.estado_cambiado.v2`.
 *
 * La misma transacción:
 *   0. toma la barrera compartida del tenant y aborta si está eliminado;
 *   1. registra el hecho en el inbox `(organizacion_id, event_id)` para que
 *      una reentrega no vuelva a aplicar el estado;
 *   2. si la clave ya existía, compara la huella: igual es duplicado, distinta
 *      es conflicto (no se sobrescribe);
 *   3. actualiza el estado vigente solo si el hecho es más nuevo o igual que
 *      el proyectado. Un evento atrasado se registra en el inbox pero no
 *      retrocede el estado.
 *
 * El inbox y el estado viven en el esquema `analytics` compartido con Django;
 * la limpieza de tenant los borra bajo el mismo bloqueo exclusivo.
 */
export class RepositorioSuscripcionPostgres implements RepositorioSuscripcion {
  constructor(private readonly pool: Pool) {}

  async registrar(
    evento: EventoSuscripcionEstadoNormalizado,
  ): Promise<ResultadoProyeccionSuscripcion> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');

      const estadoTenant = await bloquearOrganizacionCompartido(
        cliente,
        evento.organizacionId,
      );
      if (estadoTenant.eliminada) {
        await cliente.query('COMMIT');
        return 'ignorado';
      }

      const insertado = await this.registrarEnInbox(cliente, evento);
      if (!insertado) {
        return await this.resolverDuplicado(cliente, evento);
      }

      const aplicado = await this.actualizarEstado(cliente, evento);
      await cliente.query('COMMIT');
      return aplicado ? 'aplicado' : 'obsoleto';
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  private async registrarEnInbox(
    cliente: PoolClient,
    evento: EventoSuscripcionEstadoNormalizado,
  ): Promise<boolean> {
    const resultado = await cliente.query<{ event_id: string }>(
      `
        INSERT INTO analytics.suscripcion_evento (
          organizacion_id, event_id, suscripcion_id, ocurrido_en, huella,
          correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (organizacion_id, event_id) DO NOTHING
        RETURNING event_id
      `,
      [
        evento.organizacionId,
        evento.eventId,
        evento.suscripcionId,
        evento.ocurridoEn,
        evento.huella,
        evento.correlationId,
      ],
    );
    return resultado.rows.length > 0;
  }

  private async resolverDuplicado(
    cliente: PoolClient,
    evento: EventoSuscripcionEstadoNormalizado,
  ): Promise<ResultadoProyeccionSuscripcion> {
    const existente = await cliente.query<{ huella: string }>(
      `
        SELECT huella
        FROM analytics.suscripcion_evento
        WHERE organizacion_id = $1 AND event_id = $2
      `,
      [evento.organizacionId, evento.eventId],
    );

    const fila = existente.rows[0];
    if (!fila) {
      throw new ErrorConflictoSuscripcion(
        'la clave del evento quedó en conflicto sin una fila visible; se reintenta la lectura',
      );
    }
    if (fila.huella !== evento.huella) {
      throw new ErrorConflictoSuscripcion(
        'el event_id ya fue aceptado con otro contenido',
      );
    }

    await cliente.query('COMMIT');
    return 'duplicado';
  }

  private async actualizarEstado(
    cliente: PoolClient,
    evento: EventoSuscripcionEstadoNormalizado,
  ): Promise<boolean> {
    const resultado = await cliente.query<{ suscripcion_id: string }>(
      `
        INSERT INTO analytics.suscripcion_estado AS estado_actual (
          organizacion_id, suscripcion_id, proveedor_id, nombre, monto, moneda,
          ciclo, proximo_cobro, estado, fin_prueba, estado_anterior,
          evento_estado, ocurrido_en, event_id, actualizado_en
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8::date, $9, $10::date, $11,
          $12, $13, $14, now()
        )
        ON CONFLICT (organizacion_id, suscripcion_id) DO UPDATE SET
          proveedor_id = EXCLUDED.proveedor_id,
          nombre = EXCLUDED.nombre,
          monto = EXCLUDED.monto,
          moneda = EXCLUDED.moneda,
          ciclo = EXCLUDED.ciclo,
          proximo_cobro = EXCLUDED.proximo_cobro,
          estado = EXCLUDED.estado,
          fin_prueba = EXCLUDED.fin_prueba,
          estado_anterior = EXCLUDED.estado_anterior,
          evento_estado = EXCLUDED.evento_estado,
          ocurrido_en = EXCLUDED.ocurrido_en,
          event_id = EXCLUDED.event_id,
          actualizado_en = now()
        WHERE EXCLUDED.ocurrido_en >= estado_actual.ocurrido_en
        RETURNING suscripcion_id
      `,
      [
        evento.organizacionId,
        evento.suscripcionId,
        evento.proveedorId,
        evento.nombre,
        evento.monto,
        evento.moneda,
        evento.ciclo,
        evento.proximoCobro,
        evento.estado,
        evento.finPrueba,
        evento.estadoAnterior,
        evento.eventoEstado,
        evento.ocurridoEn,
        evento.eventId,
      ],
    );
    return (resultado.rowCount ?? 0) > 0;
  }
}

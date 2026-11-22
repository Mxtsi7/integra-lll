import 'dotenv/config';

import type { UsageEventPayload } from '../dominio/uso-recolectores.dto';
import { crearEventoUsoRegistrado } from '../dominio/uso-registrado.event';
import { cargarConfig } from '../infraestructura/config';
import { crearLogger } from '../infraestructura/logger';
import { PublicadorUso } from './uso.publisher';

/**
 * Publica la fixture Android del contrato v1. Sirve para probar la topología y
 * el consumidor sin la recepción HTTP:
 *
 *   npm run publicar:ejemplo
 *
 * Los IDs del ejemplo son sintéticos y no pertenecen a datos reales.
 */
const payload: UsageEventPayload = {
  version: 1,
  event_id: '22222222-2222-4222-8222-222222222222',
  recolector_id: '33333333-3333-4333-8333-333333333333',
  origen: 'android',
  inicio: '2026-11-09T12:00:00Z',
  fin: '2026-11-09T12:02:00Z',
  duracion_ms: 30_000,
  tramos_actividad: [
    { inicio: '2026-11-09T12:00:00Z', fin: '2026-11-09T12:00:30Z' },
  ],
  zona_horaria: 'America/Santiago',
  cobertura: 'completa',
  estado: 'activo',
};

async function principal(): Promise<void> {
  const config = cargarConfig();
  const logger = crearLogger(config.logLevel);

  const evento = crearEventoUsoRegistrado(payload, {
    organizacionId:
      process.env.EJEMPLO_ORGANIZACION_ID ?? '11111111-1111-4111-8111-111111111111',
    suscripcionId:
      process.env.EJEMPLO_SUSCRIPCION_ID ?? '11111111-1111-4111-8111-111111111111',
    usuarioId:
      process.env.EJEMPLO_USUARIO_ID ?? '5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d',
  });

  const publicador = await PublicadorUso.crear({
    url: config.rabbitUrl,
    exchangeUso: config.exchangeUso,
    routingKeyUso: config.routingKeyUso,
    logger,
  });

  try {
    await publicador.publicar(evento);
    console.log(JSON.stringify(evento, null, 2));
  } finally {
    await publicador.cerrar();
  }
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

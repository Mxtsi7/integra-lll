import type {
  UsoRegistradoDatos,
  UsoRegistradoEvent,
} from '../src/dominio/uso-recolectores.dto';

export const IDS = {
  organizacion: '11111111-1111-4111-8111-111111111111',
  suscripcion: '11111111-1111-4111-8111-111111111111',
  usuario: '5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d',
  evento: '22222222-2222-4222-8222-222222222222',
  recolector: '33333333-3333-4333-8333-333333333333',
  correlacion: '4b8e77a2-1c3d-4e5f-8a9b-0c1d2e3f4a5b',
} as const;

export const DATOS_BASE: UsoRegistradoDatos = {
  version: 1,
  event_id: IDS.evento,
  recolector_id: IDS.recolector,
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
  suscripcion_id: IDS.suscripcion,
  usuario_id: IDS.usuario,
};

export interface OverridesEvento {
  readonly evento?: Partial<Omit<UsoRegistradoEvent, 'datos'>>;
  readonly datos?: Partial<UsoRegistradoDatos>;
}

/** Sobre válido con la fixture Android del contrato. */
export function eventoBase(overrides: OverridesEvento = {}): UsoRegistradoEvent {
  const datos: UsoRegistradoDatos = {
    ...DATOS_BASE,
    ...overrides.datos,
  };
  const id = overrides.evento?.id ?? datos.event_id;
  return {
    evento: 'uso.registrado',
    version: 1,
    ocurrido_en: '2026-11-09T12:02:01Z',
    correlation_id: IDS.correlacion,
    organizacion_id: IDS.organizacion,
    ...overrides.evento,
    id,
    datos,
  };
}

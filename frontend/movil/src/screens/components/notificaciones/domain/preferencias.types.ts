import type {
  CanalAviso,
  PreferenciasAlertas,
  PreferenciasEditables,
} from '@ojoalgasto/shared';
import type { EstadoPermisoDispositivo } from '../../../../services/permisosNotificaciones';

export type {
  CanalAviso,
  PreferenciasAlertas,
  PreferenciasEditables,
  EstadoPermisoDispositivo,
};

export type ClaveInterruptor = Exclude<keyof PreferenciasEditables, 'dias_anticipacion'>;

/** Regla de dominio: cómputo del texto descriptivo para anticipación de cobros */
export function formatearDiasAnticipacion(dias: number): string {
  return dias === 1 ? '1 día antes del cobro.' : `${dias} días antes del cobro.`;
}

/** Regla de dominio: verifica si existe al menos un canal habilitado */
export function tieneCanalHabilitado(
  porEmail: boolean,
  porPush: boolean,
  enLaApp: boolean
): boolean {
  return Boolean(porEmail || porPush || enLaApp);
}

/** Contrato de Repositorio para Preferencias (Arquitectura Limpia) */
export interface IPreferenciasRepository {
  obtener(): Promise<PreferenciasAlertas>;
  guardar(cambios: Partial<PreferenciasEditables>): Promise<PreferenciasAlertas>;
}

/** Contrato de Gateway para Permisos del Dispositivo */
export interface IPermisosDispositivoGateway {
  obtenerEstado(): Promise<EstadoPermisoDispositivo>;
  solicitarPermiso(): Promise<EstadoPermisoDispositivo>;
  abrirAjustes?(): Promise<boolean>;
}

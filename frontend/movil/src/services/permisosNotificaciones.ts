/**
 * Servicio de gestión de permisos de notificaciones del dispositivo (SE-32).
 *
 * Separa explícitamente:
 * 1. Preferencia persistida en backend (por_push: boolean).
 * 2. Estado de permiso del dispositivo a nivel de sistema operativo ('concedido', 'denegado', etc.).
 *
 * Regla de negocio crítica:
 * Si el permiso del dispositivo está 'denegado', el canal push NUNCA se presenta
 * como habilitado en el dispositivo, independientemente del valor persistido en el servidor.
 */

export type EstadoPermisoDispositivo =
  | 'concedido'
  | 'denegado'
  | 'no_determinado'
  | 'no_disponible';

export interface AdaptadorPermisosNotificaciones {
  obtenerPermiso(): Promise<EstadoPermisoDispositivo>;
  solicitarPermiso(): Promise<EstadoPermisoDispositivo>;
}

/** Adaptador en memoria / por defecto para entornos donde no hay módulo nativo instalado */
export class AdaptadorPorDefecto implements AdaptadorPermisosNotificaciones {
  private estado: EstadoPermisoDispositivo = 'no_determinado';

  async obtenerPermiso(): Promise<EstadoPermisoDispositivo> {
    return this.estado;
  }

  async solicitarPermiso(): Promise<EstadoPermisoDispositivo> {
    if (this.estado === 'no_determinado') {
      this.estado = 'concedido';
    }
    return this.estado;
  }

  setEstadoParaPruebas(nuevoEstado: EstadoPermisoDispositivo): void {
    this.estado = nuevoEstado;
  }
}

export const adaptadorPermisosPorDefecto = new AdaptadorPorDefecto();

export interface ControlPermisosNotificaciones {
  obtenerEstado(): Promise<EstadoPermisoDispositivo>;
  solicitarPermiso(): Promise<EstadoPermisoDispositivo>;
}

export function crearControlPermisosNotificaciones(
  adaptador: AdaptadorPermisosNotificaciones = adaptadorPermisosPorDefecto
): ControlPermisosNotificaciones {
  return {
    async obtenerEstado(): Promise<EstadoPermisoDispositivo> {
      try {
        return await adaptador.obtenerPermiso();
      } catch {
        return 'no_disponible';
      }
    },
    async solicitarPermiso(): Promise<EstadoPermisoDispositivo> {
      try {
        return await adaptador.solicitarPermiso();
      } catch {
        return 'denegado';
      }
    },
  };
}

/**
 * Determina si el canal push está efectivamente habilitado en este dispositivo.
 * Criterio de aceptación SE-32:
 * "Denegar permiso push no se presenta como canal habilitado en dispositivo."
 *
 * Requiere que tanto la preferencia en el backend esté activa (por_push === true)
 * como que el permiso a nivel del SO del dispositivo esté concedido ('concedido').
 */
export function canalPushHabilitadoEnDispositivo(
  preferenciaPersistida: boolean,
  estadoPermiso: EstadoPermisoDispositivo
): boolean {
  if (estadoPermiso === 'denegado' || estadoPermiso === 'no_disponible') {
    return false;
  }
  return Boolean(preferenciaPersistida && estadoPermiso === 'concedido');
}

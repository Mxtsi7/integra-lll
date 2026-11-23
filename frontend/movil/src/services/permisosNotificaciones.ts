import { requireOptionalNativeModule } from 'expo';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

/**
 * Servicio de gestión de permisos de notificaciones del dispositivo (SE-32).
 *
 * Separa explícitamente:
 * 1. Preferencia persistida en backend (por_push: boolean).
 * 2. Estado de permiso del dispositivo a nivel de sistema operativo ('concedido', 'denegado', etc.).
 *
 * Reglas de negocio críticas:
 * - Flujo productivo veraz: Si el módulo nativo no está disponible o el permiso está denegado,
 *   el canal push NUNCA se presenta como habilitado en el dispositivo.
 * - Sin simulación ficticia por defecto: El adaptador predeterminado consulta el SO (Expo 57 o PermissionsAndroid)
 *   o devuelve 'no_disponible' si el entorno no cuenta con capacidades nativas de notificación.
 */

export type EstadoPermisoDispositivo =
  | 'concedido'
  | 'denegado'
  | 'no_determinado'
  | 'no_disponible';

export interface ExpoNotificationsPermissionsResponse {
  status: 'granted' | 'undetermined' | 'denied';
  granted: boolean;
  canAskAgain?: boolean;
  expires?: number | 'never';
}

export interface ModuloExpoNotifications {
  getPermissionsAsync(): Promise<ExpoNotificationsPermissionsResponse>;
  requestPermissionsAsync(): Promise<ExpoNotificationsPermissionsResponse>;
}

export interface AdaptadorPermisosNotificaciones {
  obtenerPermiso(): Promise<EstadoPermisoDispositivo>;
  solicitarPermiso(): Promise<EstadoPermisoDispositivo>;
  abrirAjustes?(): Promise<boolean>;
}

/**
 * Resuelve el módulo de notificaciones de Expo 57 si está presente en el entorno.
 * Soporta tanto importación de paquete como requireOptionalNativeModule de Expo.
 */
export function resolverModuloExpoNotifications(): ModuloExpoNotifications | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-notifications');
    if (mod && typeof mod.getPermissionsAsync === 'function') {
      return mod as ModuloExpoNotifications;
    }
  } catch {
    // No instalado como paquete JS
  }

  try {
    const nativo = requireOptionalNativeModule<ModuloExpoNotifications>('ExpoNotifications');
    if (nativo && typeof nativo.getPermissionsAsync === 'function') {
      return nativo;
    }
  } catch {
    // No disponible
  }

  return null;
}

/**
 * Mapea la respuesta oficial de permisos de Expo 57 al estado de dominio.
 * Referencia: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#getpermissionsasync
 */
export function mapearEstadoPermisoExpo(
  respuesta?: ExpoNotificationsPermissionsResponse | null
): EstadoPermisoDispositivo {
  if (!respuesta) return 'no_disponible';

  if (respuesta.granted === true || respuesta.status === 'granted') {
    return 'concedido';
  }

  if (
    respuesta.status === 'denied' ||
    (respuesta.granted === false && respuesta.canAskAgain === false)
  ) {
    return 'denegado';
  }

  if (respuesta.status === 'undetermined') {
    return 'no_determinado';
  }

  return 'no_disponible';
}

/**
 * Abre la pantalla de ajustes de la aplicación en el sistema operativo.
 */
export async function abrirAjustesDispositivo(): Promise<boolean> {
  try {
    if (typeof Linking?.openSettings === 'function') {
      await Linking.openSettings();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Adaptador nativo real para Expo 57 y Android nativo (PermissionsAndroid).
 * Consulta getPermissionsAsync() / requestPermissionsAsync() de Expo, o
 * PermissionsAndroid en Android nativo.
 * Si ninguna API nativa está disponible en la plataforma, devuelve 'no_disponible'
 * de forma veraz sin conceder permisos ficticios en memoria.
 */
export class AdaptadorNativoExpo implements AdaptadorPermisosNotificaciones {
  private modulo: ModuloExpoNotifications | null;

  constructor(modulo?: ModuloExpoNotifications | null) {
    this.modulo = modulo !== undefined ? modulo : resolverModuloExpoNotifications();
  }

  async obtenerPermiso(): Promise<EstadoPermisoDispositivo> {
    // 1. Prioridad: módulo Expo Notifications (iOS/Android en Expo)
    if (this.modulo) {
      try {
        const respuesta = await this.modulo.getPermissionsAsync();
        return mapearEstadoPermisoExpo(respuesta);
      } catch {
        return 'no_disponible';
      }
    }

    // 2. Fallback: Android nativo con PermissionsAndroid
    if (Platform.OS === 'android' && PermissionsAndroid) {
      try {
        const version =
          typeof Platform.Version === 'number'
            ? Platform.Version
            : parseInt(String(Platform.Version), 10);
        // Android < 33 (Android 12 y anterior) no requiere permiso en tiempo de ejecución
        if (version < 33) {
          return 'concedido';
        }
        if (PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS) {
          const concedido = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
          return concedido ? 'concedido' : 'no_determinado';
        }
      } catch {
        return 'no_disponible';
      }
    }

    return 'no_disponible';
  }

  async solicitarPermiso(): Promise<EstadoPermisoDispositivo> {
    // 1. Prioridad: módulo Expo Notifications
    if (this.modulo) {
      try {
        const respuesta = await this.modulo.requestPermissionsAsync();
        return mapearEstadoPermisoExpo(respuesta);
      } catch {
        return 'no_disponible';
      }
    }

    // 2. Fallback: Android nativo con PermissionsAndroid (despliega diálogo nativo del SO)
    if (Platform.OS === 'android' && PermissionsAndroid) {
      try {
        const version =
          typeof Platform.Version === 'number'
            ? Platform.Version
            : parseInt(String(Platform.Version), 10);
        if (version < 33) {
          return 'concedido';
        }
        if (PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS) {
          const resultado = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
          if (resultado === PermissionsAndroid.RESULTS.GRANTED) {
            return 'concedido';
          }
          if (
            resultado === PermissionsAndroid.RESULTS.DENIED ||
            resultado === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          ) {
            return 'denegado';
          }
        }
      } catch {
        return 'no_disponible';
      }
    }

    return 'no_disponible';
  }

  async abrirAjustes(): Promise<boolean> {
    return await abrirAjustesDispositivo();
  }
}

/** Instancia nativa predeterminada para el cliente móvil en ejecución */
export const adaptadorNativoPorDefecto = new AdaptadorNativoExpo();

/**
 * Adaptador en memoria para pruebas donde se requiera inyectar
 * estados controlados ('concedido', 'denegado', etc.) sin módulo nativo.
 */
export class AdaptadorParaPruebas implements AdaptadorPermisosNotificaciones {
  private estado: EstadoPermisoDispositivo;

  constructor(estadoInicial: EstadoPermisoDispositivo = 'concedido') {
    this.estado = estadoInicial;
  }

  async obtenerPermiso(): Promise<EstadoPermisoDispositivo> {
    return this.estado;
  }

  async solicitarPermiso(): Promise<EstadoPermisoDispositivo> {
    return this.estado;
  }

  setEstado(nuevoEstado: EstadoPermisoDispositivo): void {
    this.estado = nuevoEstado;
  }

  async abrirAjustes(): Promise<boolean> {
    return true;
  }
}

export interface ControlPermisosNotificaciones {
  obtenerEstado(): Promise<EstadoPermisoDispositivo>;
  solicitarPermiso(): Promise<EstadoPermisoDispositivo>;
  abrirAjustes(): Promise<boolean>;
}

export function crearControlPermisosNotificaciones(
  adaptador: AdaptadorPermisosNotificaciones = adaptadorNativoPorDefecto
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
        return 'no_disponible';
      }
    },
    async abrirAjustes(): Promise<boolean> {
      try {
        if (typeof adaptador.abrirAjustes === 'function') {
          return await adaptador.abrirAjustes();
        }
        return await abrirAjustesDispositivo();
      } catch {
        return false;
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
 * Si el permiso está denegado, no disponible o indeterminado, devuelve false.
 */
export function canalPushHabilitadoEnDispositivo(
  preferenciaPersistida: boolean,
  estadoPermiso: EstadoPermisoDispositivo
): boolean {
  if (estadoPermiso !== 'concedido') {
    return false;
  }
  return Boolean(preferenciaPersistida);
}

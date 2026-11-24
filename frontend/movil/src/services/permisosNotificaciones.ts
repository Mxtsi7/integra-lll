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
 * Puente nativo para consultar el estado efectivo de notificaciones en Android,
 * equivalente a NotificationManagerCompat.areNotificationsEnabled().
 *
 * Referencia oficial Android:
 * https://developer.android.com/reference/androidx/core/app/NotificationManagerCompat#areNotificationsEnabled()
 */
export interface PuenteNotificacionesAndroid {
  areNotificationsEnabled(): Promise<boolean> | boolean;
}

export function resolverPuenteNotificacionesAndroid(): PuenteNotificacionesAndroid | null {
  try {
    const nativo =
      requireOptionalNativeModule<PuenteNotificacionesAndroid>('NotificationManagerCompat');
    if (nativo && typeof nativo.areNotificationsEnabled === 'function') {
      return nativo;
    }
  } catch {
    // No disponible
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const mod =
      NativeModules?.NotificationManagerCompat || NativeModules?.NotificationManager;
    if (mod && typeof mod.areNotificationsEnabled === 'function') {
      return mod as PuenteNotificacionesAndroid;
    }
  } catch {
    // No disponible
  }

  return null;
}

/**
 * Adaptador nativo real para Expo 57 y Android nativo.
 * Consulta getPermissionsAsync() / requestPermissionsAsync() de Expo, o
 * NotificationManagerCompat.areNotificationsEnabled() / PermissionsAndroid en Android nativo.
 * Si ninguna API nativa está disponible en la plataforma, devuelve 'no_disponible'
 * de forma veraz sin conceder permisos ficticios en memoria ni asumir 'concedido' en Android < 33.
 */
export class AdaptadorNativoExpo implements AdaptadorPermisosNotificaciones {
  private modulo: ModuloExpoNotifications | null;
  private puenteAndroid: PuenteNotificacionesAndroid | null;

  constructor(
    modulo?: ModuloExpoNotifications | null,
    puenteAndroid?: PuenteNotificacionesAndroid | null
  ) {
    this.modulo = modulo !== undefined ? modulo : resolverModuloExpoNotifications();
    this.puenteAndroid =
      puenteAndroid !== undefined ? puenteAndroid : resolverPuenteNotificacionesAndroid();
  }

  async obtenerPermiso(): Promise<EstadoPermisoDispositivo> {
    // 1. Prioridad: módulo Expo Notifications (iOS/Android en Expo)
    // Expo Notifications verifica internamente NotificationManagerCompat.areNotificationsEnabled() en Android
    if (this.modulo) {
      try {
        const respuesta = await this.modulo.getPermissionsAsync();
        return mapearEstadoPermisoExpo(respuesta);
      } catch {
        return 'no_disponible';
      }
    }

    // 2. Fallback: Android
    if (Platform.OS === 'android') {
      // 2.1 Si existe puente nativo equivalente a NotificationManagerCompat.areNotificationsEnabled()
      if (this.puenteAndroid && typeof this.puenteAndroid.areNotificationsEnabled === 'function') {
        try {
          const habilitado = await this.puenteAndroid.areNotificationsEnabled();
          return habilitado ? 'concedido' : 'denegado';
        } catch {
          return 'no_disponible';
        }
      }

      // 2.2 En Android 13+ (API >= 33), PermissionsAndroid permite consultar POST_NOTIFICATIONS
      const version =
        typeof Platform.Version === 'number'
          ? Platform.Version
          : parseInt(String(Platform.Version), 10);

      if (
        version >= 33 &&
        PermissionsAndroid &&
        PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS
      ) {
        try {
          const concedido = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
          return concedido ? 'concedido' : 'no_determinado';
        } catch {
          return 'no_disponible';
        }
      }

      // En Android < 33 sin capacidad nativa de consulta de areNotificationsEnabled:
      // Devolver verazmente 'no_disponible', nunca asumir 'concedido' sin consultarlo
      return 'no_disponible';
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

    // 2. Fallback: Android
    if (Platform.OS === 'android') {
      // 2.1 Si existe puente nativo NotificationManagerCompat, consultar el estado efectivo
      if (this.puenteAndroid && typeof this.puenteAndroid.areNotificationsEnabled === 'function') {
        try {
          const habilitado = await this.puenteAndroid.areNotificationsEnabled();
          return habilitado ? 'concedido' : 'denegado';
        } catch {
          return 'no_disponible';
        }
      }

      // 2.2 En Android 13+ (API >= 33), solicitar POST_NOTIFICATIONS al sistema operativo
      const version =
        typeof Platform.Version === 'number'
          ? Platform.Version
          : parseInt(String(Platform.Version), 10);

      if (
        version >= 33 &&
        PermissionsAndroid &&
        PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS
      ) {
        try {
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
        } catch {
          return 'no_disponible';
        }
      }

      // En Android < 33 sin capacidad nativa de consulta:
      return 'no_disponible';
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

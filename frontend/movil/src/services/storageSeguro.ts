import * as SecureStore from 'expo-secure-store';
import {
  configurarTokenStorage,
  guardarTokens,
  logout,
  obtenerAccessToken,
  obtenerRefreshToken,
} from '@ojoalgasto/shared';

export interface IBackendStorageSeguro {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
  isAvailableAsync?(): Promise<boolean>;
}

export const CLAVES_SEGURAS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  DESFASE_RELOJ: 'desfase_reloj_ms',
} as const;

/**
 * Backend por defecto basado en expo-secure-store nativo.
 */
const backendNativoSecureStore: IBackendStorageSeguro = {
  getItemAsync: (k: string) => SecureStore.getItemAsync(k),
  setItemAsync: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  deleteItemAsync: (k: string) => SecureStore.deleteItemAsync(k),
  isAvailableAsync: () =>
    typeof SecureStore.isAvailableAsync === 'function'
      ? SecureStore.isAvailableAsync()
      : Promise.resolve(true),
};

let backendActual: IBackendStorageSeguro = backendNativoSecureStore;

/**
 * Caché síncrona en memoria para satisfacer el contrato síncrono de @ojoalgasto/shared.
 */
let cacheMemoria: Record<string, string> = {};
let storageInicializado = false;
let storageHidratado = false;

/**
 * Permite inyectar un backend alternativo de almacenamiento seguro (ideal para pruebas y shims).
 */
export function configurarBackendStorage(backend: IBackendStorageSeguro): void {
  backendActual = backend;
}

/**
 * Adaptador de almacenamiento síncrono para @ojoalgasto/shared.
 * Lee y escribe inmediatamente en memoria y replica de forma asíncrona y segura en SecureStore.
 */
export const adaptadorStorageSincrono = {
  getItem(key: string): string | null {
    return cacheMemoria[key] ?? null;
  },
  setItem(key: string, value: string): void {
    cacheMemoria[key] = value;
    void backendActual.setItemAsync(key, value).catch((err) => {
      console.warn(`[StorageSeguro] Error al escribir clave '${key}':`, err);
    });
  },
  removeItem(key: string): void {
    delete cacheMemoria[key];
    void backendActual.deleteItemAsync(key).catch((err) => {
      console.warn(`[StorageSeguro] Error al eliminar clave '${key}':`, err);
    });
  },
};

/**
 * Registra el adaptador de almacenamiento seguro en @ojoalgasto/shared.
 * Desvincula por completo la app móvil de cualquier lectura o escritura en localStorage web.
 */
export function inicializarStorageSeguro(backendPersonalizado?: IBackendStorageSeguro): void {
  if (backendPersonalizado) {
    configurarBackendStorage(backendPersonalizado);
  }
  configurarTokenStorage(adaptadorStorageSincrono);
  storageInicializado = true;
}

/**
 * Hidrata la sesión asíncronamente desde SecureStore hacia el caché síncrono en memoria.
 * Se debe ejecutar en el bootstrap de la app antes de decidir la navegación.
 */
export async function hidratarSesionSegura(): Promise<{
  hidratado: boolean;
  hayTokens: boolean;
}> {
  if (!storageInicializado) {
    inicializarStorageSeguro();
  }

  try {
    const [access, refresh, desfase] = await Promise.all([
      backendActual.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN),
      backendActual.getItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN),
      backendActual.getItemAsync(CLAVES_SEGURAS.DESFASE_RELOJ),
    ]);

    if (access) cacheMemoria[CLAVES_SEGURAS.ACCESS_TOKEN] = access;
    else delete cacheMemoria[CLAVES_SEGURAS.ACCESS_TOKEN];

    if (refresh) cacheMemoria[CLAVES_SEGURAS.REFRESH_TOKEN] = refresh;
    else delete cacheMemoria[CLAVES_SEGURAS.REFRESH_TOKEN];

    if (desfase) cacheMemoria[CLAVES_SEGURAS.DESFASE_RELOJ] = desfase;
    else delete cacheMemoria[CLAVES_SEGURAS.DESFASE_RELOJ];

    storageHidratado = true;

    return {
      hidratado: true,
      hayTokens: Boolean(access),
    };
  } catch (err) {
    console.warn('[StorageSeguro] Fallo al hidratar tokens desde SecureStore:', err);
    storageHidratado = true;
    return {
      hidratado: false,
      hayTokens: false,
    };
  }
}

/**
 * Guarda los tokens actualizando inmediatamente la memoria síncrona
 * y aguardando la confirmación de escritura en hardware seguro.
 */
export async function guardarTokensSeguros(tokens: {
  access_token: string;
  refresh_token: string;
}): Promise<void> {
  // 1. Escritura síncrona en memoria a través de shared (calcula desfase de reloj)
  guardarTokens(tokens);

  // 2. Persistencia atómica asegurada en SecureStore
  const promesas: Promise<void>[] = [
    backendActual.setItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN, tokens.access_token),
    backendActual.setItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN, tokens.refresh_token),
  ];

  const desfase = cacheMemoria[CLAVES_SEGURAS.DESFASE_RELOJ];
  if (desfase) {
    promesas.push(backendActual.setItemAsync(CLAVES_SEGURAS.DESFASE_RELOJ, desfase));
  }

  await Promise.all(promesas);
}

/**
 * Limpia coherentemente la sesión activa:
 * - Purga el caché síncrono en memoria.
 * - Invoca logout() de shared.
 * - Elimina de forma asíncrona todas las claves sensibles persistidas en SecureStore.
 */
export async function limpiarSesionSegura(): Promise<void> {
  // 1. Limpieza en memoria síncrona
  cacheMemoria = {};
  logout();

  // 2. Limpieza en persistencia segura
  await Promise.allSettled([
    backendActual.deleteItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN),
    backendActual.deleteItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN),
    backendActual.deleteItemAsync(CLAVES_SEGURAS.DESFASE_RELOJ),
  ]);
}

/**
 * Verifica si el almacenamiento ya completó la fase de hidratación inicial.
 */
export function estaStorageHidratado(): boolean {
  return storageHidratado;
}

/**
 * Obtiene los tokens actuales en memoria (síncrono).
 */
export function obtenerTokensSeguros(): {
  access_token: string | null;
  refresh_token: string | null;
} {
  return {
    access_token: obtenerAccessToken(),
    refresh_token: obtenerRefreshToken(),
  };
}

/**
 * Función exclusiva para reiniciar el estado interno en suites de pruebas.
 */
export function __reiniciarEstadoParaPruebas(): void {
  cacheMemoria = {};
  storageInicializado = false;
  storageHidratado = false;
  backendActual = backendNativoSecureStore;
}

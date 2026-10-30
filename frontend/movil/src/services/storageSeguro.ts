import * as SecureStore from 'expo-secure-store';
import {
  configurarTokenStorage,
  guardarTokens,
  logout,
  obtenerAccessToken,
  obtenerRefreshToken,
  tokenExpirado,
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
  LIMPIEZA_PENDIENTE: 'limpieza_pendiente',
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

// Generación de sesión monótona para aislar operaciones concurrentes
let generacionActual = 1;
let sesionEnLimpieza = false;

// Cola / Mutex de serialización de operaciones en backendActual
let colaPromesa: Promise<void> = Promise.resolve();
const promesasPorGeneracion = new Map<number, Promise<void>[]>();

/**
 * Permite inyectar un backend alternativo de almacenamiento seguro (ideal para pruebas y shims).
 */
export function configurarBackendStorage(backend: IBackendStorageSeguro): void {
  backendActual = backend;
}

/**
 * Espera a que todas las operaciones actualmente en cola en el hardware seguro se resuelvan o rechacen.
 */
export async function esperarMutacionesPendientes(): Promise<void> {
  try {
    await colaPromesa;
  } catch {
    // Las excepciones individuales son manejadas por sus respectivos iniciadores
  }
}

/**
 * Ejecuta el borrado nativo con reintentos y política durable de invalidación si falla.
 */
async function ejecutarDeleteConReintentos(key: string, maxReintentos = 2): Promise<void> {
  let ultimoError: unknown = null;
  for (let intento = 0; intento <= maxReintentos; intento++) {
    try {
      await backendActual.deleteItemAsync(key);
      return;
    } catch (err) {
      ultimoError = err;
    }
  }

  // Política durable: si el borrado nativo falla tras reintentos, destruir credenciales
  // sobrescribiendo con cadena vacía y marcando la sesión como pendiente de limpieza.
  try {
    await backendActual.setItemAsync(key, '');
  } catch {}

  try {
    await backendActual.setItemAsync(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE, '1');
  } catch {}

  throw ultimoError ?? new Error(`Fallo persistente al eliminar clave '${key}' en SecureStore`);
}

/**
 * Encola una operación de escritura serializada en el hardware seguro,
 * protegiéndola contra obsolescencia por cambios de generación de sesión.
 */
function encolarSet(key: string, value: string, gen: number): Promise<void> {
  const promesaOperacion = new Promise<void>((resolve, reject) => {
    colaPromesa = colaPromesa
      .catch(() => {})
      .then(async () => {
        // Si la generación quedó obsoleta antes de iniciar la escritura, abortar
        if (gen < generacionActual) {
          resolve();
          return;
        }

        try {
          await backendActual.setItemAsync(key, value);

          // Si mientras se escribía en hardware cambió la sesión (ej. logout o 401),
          // revertir inmediatamente la clave en el hardware para que la escritura no sobreviva
          if (gen < generacionActual) {
            try {
              await backendActual.deleteItemAsync(key);
            } catch {}
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
  });

  const lista = promesasPorGeneracion.get(gen);
  if (lista) {
    lista.push(promesaOperacion);
  }

  return promesaOperacion;
}

/**
 * Encola una operación de eliminación serializada en el hardware seguro,
 * evitando que borrados de una sesión antigua eliminen datos de una sesión posterior.
 */
function encolarDelete(key: string, gen: number): Promise<void> {
  const promesaOperacion = new Promise<void>((resolve, reject) => {
    colaPromesa = colaPromesa
      .catch(() => {})
      .then(async () => {
        // Si una sesión más nueva ya comenzó, este borrado antiguo no debe borrar datos nuevos
        if (gen < generacionActual) {
          resolve();
          return;
        }

        try {
          await ejecutarDeleteConReintentos(key, 2);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
  });

  const lista = promesasPorGeneracion.get(gen);
  if (lista) {
    lista.push(promesaOperacion);
  }

  return promesaOperacion;
}

/**
 * Adaptador de almacenamiento síncrono para @ojoalgasto/shared.
 * Lee y escribe inmediatamente en memoria y serializa réplicas ordenadas en SecureStore.
 */
export const adaptadorStorageSincrono = {
  getItem(key: string): string | null {
    return cacheMemoria[key] ?? null;
  },
  setItem(key: string, value: string): void {
    cacheMemoria[key] = value;
    void encolarSet(key, value, generacionActual).catch((err) => {
      console.warn(`[StorageSeguro] Error al escribir clave '${key}':`, err);
    });
  },
  removeItem(key: string): void {
    delete cacheMemoria[key];
    if (!sesionEnLimpieza && key === CLAVES_SEGURAS.ACCESS_TOKEN) {
      // Si shared disparó logout() directamente (ej. interceptor 401 de pedir()),
      // invalidar de inmediato la generación para abortar escrituras pendientes en vuelo
      generacionActual++;
    }
    void encolarDelete(key, generacionActual).catch((err) => {
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
 * Coordina con cualquier mutación pendiente antes de leer y comprueba políticas de cierre.
 */
export async function hidratarSesionSegura(): Promise<{
  hidratado: boolean;
  hayTokens: boolean;
}> {
  if (!storageInicializado) {
    inicializarStorageSeguro();
  }

  // 1. Esperar que cualquier mutación anterior en la cola haya terminado
  await esperarMutacionesPendientes();

  try {
    // 2. Comprobar si existe una limpieza pendiente no confirmada previamente.
    // No convertimos fallos en ausencia con .catch(() => null); si la lectura
    // arroja error, se captura en el catch exterior y retorna de forma segura
    // { hidratado: false, hayTokens: false } sin rescatar credenciales.
    const limpiezaPendiente = await backendActual.getItemAsync(
      CLAVES_SEGURAS.LIMPIEZA_PENDIENTE
    );

    if (limpiezaPendiente === '1') {
      // Hubo un cierre de sesión previo con fallo persistente: no recuperar esa sesión.
      // Borrar primero credenciales; solo si se eliminan efectivamente se borra la marca.
      let credencialesEliminadas = false;
      try {
        await Promise.all([
          backendActual.deleteItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN),
          backendActual.deleteItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN),
          backendActual.deleteItemAsync(CLAVES_SEGURAS.DESFASE_RELOJ).catch(() => {}),
        ]);
        credencialesEliminadas = true;
      } catch {
        credencialesEliminadas = false;
      }

      if (credencialesEliminadas) {
        try {
          await backendActual.deleteItemAsync(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE);
        } catch {}
      }

      cacheMemoria = {};
      storageHidratado = true;
      return { hidratado: true, hayTokens: false };
    }

    const [access, refresh, desfase] = await Promise.all([
      backendActual.getItemAsync(CLAVES_SEGURAS.ACCESS_TOKEN),
      backendActual.getItemAsync(CLAVES_SEGURAS.REFRESH_TOKEN),
      backendActual.getItemAsync(CLAVES_SEGURAS.DESFASE_RELOJ),
    ]);

    // Política estricta: se requieren ambos tokens, presentes y no vacíos
    if (!access || !refresh || access.trim() === '' || refresh.trim() === '') {
      cacheMemoria = {};
      storageHidratado = true;
      return {
        hidratado: true,
        hayTokens: false,
      };
    }

    cacheMemoria[CLAVES_SEGURAS.ACCESS_TOKEN] = access;
    cacheMemoria[CLAVES_SEGURAS.REFRESH_TOKEN] = refresh;

    if (desfase && desfase.trim() !== '') {
      cacheMemoria[CLAVES_SEGURAS.DESFASE_RELOJ] = desfase;
    } else {
      delete cacheMemoria[CLAVES_SEGURAS.DESFASE_RELOJ];
    }

    storageHidratado = true;

    return {
      hidratado: true,
      hayTokens: true,
    };
  } catch (err) {
    console.warn('[StorageSeguro] Fallo al hidratar tokens desde SecureStore:', err);
    cacheMemoria = {};
    storageHidratado = true;
    return {
      hidratado: false,
      hayTokens: false,
    };
  }
}

/**
 * Guarda los tokens actualizando la memoria síncrona y aguardando la persistencia
 * de todas las claves en hardware seguro. Si falla cualquier escritura, realiza rollback completo.
 */
export async function guardarTokensSeguros(tokens: {
  access_token: string;
  refresh_token: string;
}): Promise<void> {
  if (!storageInicializado) {
    inicializarStorageSeguro();
  }

  const gen = ++generacionActual;
  promesasPorGeneracion.set(gen, []);

  try {
    guardarTokens(tokens);
    encolarDelete(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE, gen);
    const promesas = promesasPorGeneracion.get(gen) ?? [];
    await Promise.all(promesas);
  } catch (err) {
    // Si otra operación posterior ya inició (gen < generacionActual),
    // este guardado obsoleto NO debe limpiar la RAM ni invalidar la nueva sesión.
    if (gen === generacionActual) {
      cacheMemoria = {};
      logout();

      // Reversión en hardware seguro
      const genRollback = ++generacionActual;
      promesasPorGeneracion.set(genRollback, []);
      const p1 = encolarDelete(CLAVES_SEGURAS.ACCESS_TOKEN, genRollback);
      const p2 = encolarDelete(CLAVES_SEGURAS.REFRESH_TOKEN, genRollback);
      const p3 = encolarDelete(CLAVES_SEGURAS.DESFASE_RELOJ, genRollback);

      try {
        await Promise.all([p1, p2, p3]);
      } catch (rollbackErr) {
        console.warn('[StorageSeguro] Error durante rollback en SecureStore:', rollbackErr);
      } finally {
        promesasPorGeneracion.delete(genRollback);
      }
    }

    throw new Error(
      `Fallo al persistir tokens en almacenamiento seguro: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    promesasPorGeneracion.delete(gen);
  }
}

/**
 * Limpia coherentemente la sesión activa:
 * - Purga inmediatamente el caché síncrono en memoria y llama a logout() de shared.
 * - Espera la eliminación segura de todas las claves persistidas en SecureStore.
 * - Si el borrado en SecureStore falla, aplica política durable y arroja excepción explícita.
 */
export async function limpiarSesionSegura(): Promise<void> {
  if (!storageInicializado) {
    inicializarStorageSeguro();
  }

  sesionEnLimpieza = true;
  const gen = ++generacionActual;
  promesasPorGeneracion.set(gen, []);

  try {
    // 1. Limpieza inmediata e incondicional en memoria síncrona
    cacheMemoria = {};
    logout();

    // 2. Borrado explícito de marca de limpieza previa
    encolarDelete(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE, gen);

    // 3. Esperar a que se completen todos los borrados de esta generación
    const promesas = promesasPorGeneracion.get(gen) ?? [];
    await Promise.all(promesas);
  } catch (err) {
    // La memoria ya está limpia (la navegación pública queda protegida de inmediato),
    // pero no confirmamos el cierre como exitoso si la persistencia falló
    throw new Error(
      `Fallo al limpiar sesión en almacenamiento seguro: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    sesionEnLimpieza = false;
    promesasPorGeneracion.delete(gen);
  }
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
 * Decodifica de forma segura el payload de un JWT sin validar su firma.
 */
export function decodificarPayloadJwt(token: string): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const conPadding = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const jsonStr =
      typeof atob === 'function'
        ? atob(conPadding)
        : typeof Buffer !== 'undefined'
        ? Buffer.from(conPadding, 'base64').toString('utf8')
        : null;
    if (!jsonStr) return null;
    const datos: unknown = JSON.parse(jsonStr);
    return typeof datos === 'object' && datos !== null
      ? (datos as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Valida que una cadena tenga estructura de JWT legible y campos semánticamente coherentes:
 * - Cadena no vacía con 3 partes separadas por '.'
 * - Payload decodificable en JSON válido
 * - Si existen claims exp e iat, exp debe ser estrictamente posterior a iat (exp > iat)
 */
export function validarFormatoToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }
  const payload = decodificarPayloadJwt(token);
  if (!payload) {
    return false;
  }
  if (typeof payload.exp === 'number' && typeof payload.iat === 'number') {
    if (payload.exp <= payload.iat) {
      return false;
    }
  }
  return true;
}

/**
 * Valida si un access token tiene formato legible y no está vencido
 * según el tiempo de referencia y desfase horario proporcionados.
 * No intenta adivinar el desfase a partir de `iat` para no anular la expiración de tokens antiguos.
 *
 * @param accessToken Cadena JWT
 * @param desfaseMs Desfase temporal en ms (hora servidor - hora local)
 * @param ahoraMs Marca temporal local de evaluación (por defecto Date.now())
 */
export function esTokenValido(
  accessToken: string,
  desfaseMs: number = 0,
  ahoraMs: number = Date.now()
): boolean {
  if (!validarFormatoToken(accessToken)) {
    return false;
  }
  return !tokenExpirado(accessToken, ahoraMs + desfaseMs);
}

/**
 * Función exclusiva para reiniciar el estado interno en suites de pruebas.
 */
export function __reiniciarEstadoParaPruebas(): void {
  cacheMemoria = {};
  storageInicializado = false;
  storageHidratado = false;
  backendActual = backendNativoSecureStore;
  generacionActual = 1;
  sesionEnLimpieza = false;
  colaPromesa = Promise.resolve();
  promesasPorGeneracion.clear();
}

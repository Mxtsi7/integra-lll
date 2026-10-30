import * as SecureStore from 'expo-secure-store';
import { configurarTokenStorage } from '@ojoalgasto/shared';

/**
 * Almacenamiento de sesión para la app móvil (VI-16).
 *
 * `@ojoalgasto/shared` expone una API *síncrona* (`getItem`/`setItem`) porque
 * la web usa localStorage. SecureStore es asíncrono, así que se usa una capa
 * en memoria como espejo: la app lee y escribe al instante y cada cambio se
 * persiste cifrado en segundo plano. Antes de decidir si hay sesión, el
 * arranque llama a `hidratarSesion()` para cargar el espejo desde SecureStore.
 *
 * Las escrituras de una misma clave se ejecutan en orden (cola serializada):
 * un `setItemAsync` que tarda no puede completarse *después* de un
 * `deleteItemAsync` y resucitar un token que el usuario ya cerró. Además, la
 * generación de cada clave invalida escrituras e hidrataciones que quedaron
 * obsoletas mientras esperaban al almacén.
 *
 * Si SecureStore no está disponible (por ejemplo la build web o un fallo del
 * keystore), los tokens quedan sólo en memoria: la app sigue funcionando en
 * esa ejecución, pero no inventa persistencia ni cae un almacén inseguro
 * (localStorage/AsyncStorage en claro).
 */
const PREFIJO = 'ojoalgasto.';
const CLAVES = ['access_token', 'refresh_token', 'desfase_reloj_ms'] as const;

// Generación de escritura: se incrementa cada vez que se encola un cambio.
// Una operación diferida que lleva una generación antigua ya fue reemplazada
// por otra posterior y no debe aplicarse.
const generacion = new Map<string, number>();
// Cola por clave: garantiza que set/delete lleguen al almacén en el orden en
// que la app los pidió, aunque SecureStore tarde.
const colas = new Map<string, Promise<void>>();
const memoria = new Map<string, string>();
let hidratando: Promise<void> | null = null;
let disponible = true;

function claveFisica(clave: string): string {
  return `${PREFIJO}${clave}`;
}

/** Encola una operación de almacén para `clave`, respetando el orden pedido. */
function encolar(clave: string, tarea: () => Promise<void>): void {
  const anterior = colas.get(clave) ?? Promise.resolve();
  const siguiente = anterior.then(tarea, tarea);
  colas.set(clave, siguiente);
  void siguiente.finally(() => {
    if (colas.get(clave) === siguiente) colas.delete(clave);
  });
}

async function leerPersistido(clave: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(claveFisica(clave));
  } catch {
    disponible = false;
    return null;
  }
}

async function guardarPersistido(clave: string, valor: string, gen: number): Promise<void> {
  if (!disponible) return;
  // Otra escritura o un borrado posterior ya reemplazó a ésta: no persistir.
  if ((generacion.get(clave) ?? 0) !== gen) return;
  try {
    await SecureStore.setItemAsync(claveFisica(clave), valor, {
      // El refresh token no debe salir del dispositivo ni aparecer en backups.
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    disponible = false;
  }
}

async function borrarPersistido(clave: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(claveFisica(clave));
  } catch {
    // Nada que borrar o almacén no disponible.
  }
}

/**
 * Instala el almacén de tokens. Se llama una vez al arrancar (App.tsx), antes
 * de cualquier lectura de sesión.
 */
export function instalarAlmacenSeguro(): void {
  configurarTokenStorage({
    getItem: (clave) => memoria.get(clave) ?? null,
    setItem: (clave, valor) => {
      memoria.set(clave, valor);
      const gen = (generacion.get(clave) ?? 0) + 1;
      generacion.set(clave, gen);
      // Dentro de la cola se reevalúa la generación: si un borrado se encoló
      // después, esta escritura ya no representa el estado actual.
      encolar(clave, () => guardarPersistido(clave, valor, gen));
    },
    removeItem: (clave) => {
      memoria.delete(clave);
      generacion.set(clave, (generacion.get(clave) ?? 0) + 1);
      // El borrado también se encola: así espera a cualquier escritura previa
      // y el valor no reaparece cuando esa escritura termine.
      encolar(clave, () => borrarPersistido(clave));
    },
  });
}

/**
 * Carga los tokens cifrados al espejo en memoria. Idempotente y sin lanzar:
 * si el almacén falla, la sesión simplemente no se recupera y se muestra el
 * login. Se espera antes de `haySesionValida()` para no decidir con el espejo
 * vacío.
 */
export function hidratarSesion(): Promise<void> {
  if (hidratando) return hidratando;

  hidratando = (async () => {
    for (const clave of CLAVES) {
      // Si mientras se lee la app escribe o cierra sesión, esa generación es
      // la verdad: no se reinyecta el valor viejo del almacén.
      const gen = generacion.get(clave) ?? 0;
      const valor = await leerPersistido(clave);
      if (valor === null) continue;
      if ((generacion.get(clave) ?? 0) !== gen) continue;
      if (memoria.has(clave)) continue;
      memoria.set(clave, valor);
    }
  })();

  return hidratando;
}

/**
 * Sólo para pruebas: espera a que terminen las escrituras y borrados
 * encolados. La app no lo necesita porque el espejo en memoria responde al
 * instante.
 */
export async function esperarAlmacenSeguroParaPruebas(): Promise<void> {
  // Puede haber una operación nueva encolada mientras se esperaba la anterior.
  while (colas.size > 0) {
    await Promise.all([...colas.values()]);
  }
}

/** Sólo para pruebas: deja el espejo como recién instalado. */
export function reiniciarAlmacenSeguroParaPruebas(): void {
  memoria.clear();
  generacion.clear();
  colas.clear();
  hidratando = null;
  disponible = true;
}

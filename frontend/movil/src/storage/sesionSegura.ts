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
 * Si SecureStore no está disponible (por ejemplo la build web o un fallo del
 * keystore), los tokens quedan sólo en memoria: la app sigue funcionando en
 * esa ejecución, pero no inventa persistencia ni cae un almacén inseguro
 * (localStorage/AsyncStorage en claro).
 */
const PREFIJO = 'ojoalgasto.';
const CLAVES = ['access_token', 'refresh_token', 'desfase_reloj_ms'] as const;

// Generación de escritura: se incrementa cada vez que se borra una clave.
// Una escritura diferida que lleva una generación antigua no se persiste,
// evitando la carrera escritura-diferida → logout → completar-escritura.
const generacion = new Map<string, number>();
const memoria = new Map<string, string>();
let hidratando: Promise<void> | null = null;
let disponible = true;

function claveFisica(clave: string): string {
  return `${PREFIJO}${clave}`;
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
  // Si la generación de esta escritura es anterior a la actual, el valor ya
  // fue descartado (logout u otra escritura posterior ganó): no persistir.
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
      void guardarPersistido(clave, valor, gen);
    },
    removeItem: (clave) => {
      memoria.delete(clave);
      // Avanzar la generación invalida escrituras diferidas en vuelo.
      generacion.set(clave, (generacion.get(clave) ?? 0) + 1);
      void borrarPersistido(clave);
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
      const valor = await leerPersistido(clave);
      if (valor !== null) memoria.set(clave, valor);
    }
  })();

  return hidratando;
}

/** Sólo para pruebas: deja el espejo como recién instalado. */
export function reiniciarAlmacenSeguroParaPruebas(): void {
  memoria.clear();
  generacion.clear();
  hidratando = null;
  disponible = true;
}

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
 * Un cierre de sesión no se declara exitoso sólo porque la RAM quedó vacía.
 * `confirmarCierrePersistente()` espera los borrados y devuelve un resultado
 * observable; mientras no se confirme, queda una marca durable que impide que
 * la hidratación vuelva a cargar la sesión anterior. Si `deleteItemAsync`
 * falla se intenta sobrescribir el valor con un centinela vacío; aun así el
 * resultado se informa como no confirmado para que AuthContext bloquee las
 * rutas privadas. La reintento está en `reintentarCierrePersistente()`.
 *
 * Si SecureStore no está disponible (por ejemplo la build web o un fallo del
 * keystore), los tokens quedan sólo en memoria: la app sigue funcionando en
 * esa ejecución, pero no inventa persistencia ni cae un almacén inseguro
 * (localStorage/AsyncStorage en claro).
 */
const PREFIJO = 'ojoalgasto.';
const CLAVES = ['access_token', 'refresh_token', 'desfase_reloj_ms'] as const;
const CLAVE_MARCADOR = 'cierre_pendiente';
const VALOR_MARCADOR = '1';
const VALOR_CENTINELA = '';

const OPCIONES_CIFRADO = {
  // El refresh token no debe salir del dispositivo ni aparecer en backups.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type ResultadoOperacion = { ok: boolean; error?: string };

export type ResultadoCierre = {
  ok: boolean;
  pendiente: boolean;
  error?: string;
};

// Generación de escritura: se incrementa cada vez que se encola un cambio.
// Una operación diferida que lleva una generación antigua ya fue reemplazada
// por otra posterior y no debe aplicarse.
const generacion = new Map<string, number>();
// Cola por clave: garantiza que set/delete lleguen al almacén en el orden en
// que la app los pidió, aunque SecureStore tarde.
const colas = new Map<string, Promise<void>>();
// Última operación encolada por clave. `confirmarCierrePersistente()` toma una
// instantánea: si después entra otra sesión, sus escrituras no se confunden
// con el cierre que se está confirmando.
const operaciones = new Map<string, Promise<ResultadoOperacion>>();
const memoria = new Map<string, string>();
let hidratando: Promise<void> | null = null;
let disponible = true;
let cierrePendiente = false;
let cierreEnCurso = false;

function claveFisica(clave: string): string {
  return `${PREFIJO}${clave}`;
}

function ejecutarTarea(tarea: () => Promise<boolean>): Promise<ResultadoOperacion> {
  return tarea().then(
    (ok) => ({ ok }),
    (error: unknown) => ({ ok: false, error: String(error) })
  );
}

/** Encola una operación de almacén para `clave`, respetando el orden pedido. */
function encolar(
  clave: string,
  tarea: () => Promise<boolean>
): Promise<ResultadoOperacion> {
  const anterior = colas.get(clave) ?? Promise.resolve();
  const siguiente = anterior.then(
    () => ejecutarTarea(tarea),
    () => ejecutarTarea(tarea)
  );
  const cola = siguiente.then(
    () => undefined,
    () => undefined
  );
  colas.set(clave, cola);
  operaciones.set(clave, siguiente);
  void cola.finally(() => {
    if (colas.get(clave) === cola) colas.delete(clave);
  });
  return siguiente;
}

async function leerPersistido(clave: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(claveFisica(clave));
  } catch {
    disponible = false;
    return null;
  }
}

async function guardarPersistido(
  clave: string,
  valor: string,
  gen: number
): Promise<boolean> {
  // Sin almacén persistente no hay nada durable que confirmar; el espejo en
  // memoria sigue siendo la fuente de verdad de esta ejecución.
  if (!disponible) return true;
  // Otra escritura o un borrado posterior ya reemplazó a ésta: no persistir.
  if ((generacion.get(clave) ?? 0) !== gen) return true;
  try {
    await SecureStore.setItemAsync(claveFisica(clave), valor, OPCIONES_CIFRADO);
    return true;
  } catch {
    disponible = false;
    return false;
  }
}

/**
 * Borra una clave. Si SecureStore rechaza el borrado, intenta dejarla
 * invalidada con un centinela para que un reinicio no restaure el token. El
 * valor de retorno sigue siendo `false`: el borrado no fue confirmado y quien
 * llama debe tratar el cierre como pendiente.
 */
async function borrarPersistido(clave: string): Promise<boolean> {
  if (!disponible) return true;
  try {
    await SecureStore.deleteItemAsync(claveFisica(clave));
    return true;
  } catch {
    try {
      await SecureStore.setItemAsync(
        claveFisica(clave),
        VALOR_CENTINELA,
        OPCIONES_CIFRADO
      );
      return false;
    } catch {
      disponible = false;
      return false;
    }
  }
}

async function escribirMarcador(): Promise<boolean> {
  if (!disponible) return true;
  try {
    await SecureStore.setItemAsync(
      claveFisica(CLAVE_MARCADOR),
      VALOR_MARCADOR,
      OPCIONES_CIFRADO
    );
    return true;
  } catch {
    disponible = false;
    return false;
  }
}

async function borrarMarcador(): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(claveFisica(CLAVE_MARCADOR));
    return true;
  } catch {
    try {
      // El centinela vacío no significa "cierre pendiente"; la marca queda
      // invalidada aunque el borrado físico no se haya confirmado.
      await SecureStore.setItemAsync(
        claveFisica(CLAVE_MARCADOR),
        VALOR_CENTINELA,
        OPCIONES_CIFRADO
      );
      return true;
    } catch {
      disponible = false;
      return false;
    }
  }
}

function encolarCierre(): void {
  if (!cierreEnCurso) {
    cierreEnCurso = true;
    encolar(CLAVE_MARCADOR, escribirMarcador);
  }
  for (const clave of CLAVES) {
    generacion.set(clave, (generacion.get(clave) ?? 0) + 1);
    encolar(clave, () => borrarPersistido(clave));
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
      if (clave === 'access_token' || clave === 'refresh_token') {
        // Sacar un token es un cierre de sesión: la marca durable se escribe
        // antes de los borrados para sobrevivir a un reinicio si fallan.
        // Otras claves (p. ej. el desfase de reloj) se borran solas: no son
        // una sesión y no deben disparar el cierre completo.
        encolarCierre();
      } else {
        encolar(clave, () => borrarPersistido(clave));
      }
    },
  });
}

/**
 * Espera y evalúa las operaciones de cierre encoladas. Devuelve `ok: false` si
 * algún borrado no pudo confirmarse; en ese caso deja la marca durable para
 * que `hidratarSesion()` no restaure la sesión anterior.
 */
export async function confirmarCierrePersistente(): Promise<ResultadoCierre> {
  const claves = [...CLAVES, CLAVE_MARCADOR];
  const instantaneas = claves.map(
    (clave) =>
      operaciones.get(clave) ??
      Promise.resolve<ResultadoOperacion>({ ok: true })
  );
  const resultados = await Promise.all(instantaneas);
  await esperarAlmacenSeguroParaPruebas();

  const fallo = resultados.find((resultado) => !resultado.ok);
  if (fallo) {
    cierrePendiente = true;
    cierreEnCurso = false;
    return {
      ok: false,
      pendiente: true,
      error: fallo.error ?? 'No se pudo confirmar la limpieza del almacén seguro',
    };
  }

  const marcador = await encolar(CLAVE_MARCADOR, borrarMarcador);
  cierreEnCurso = false;
  if (!marcador.ok) {
    cierrePendiente = true;
    return {
      ok: false,
      pendiente: true,
      error: marcador.error ?? 'No se pudo confirmar el cierre de sesión',
    };
  }

  cierrePendiente = false;
  return { ok: true, pendiente: false };
}

/**
 * Reintenta la limpieza durable. Se usa cuando el cierre anterior quedó
 * pendiente y desde la pantalla de error el usuario pide reintentar.
 */
export async function reintentarCierrePersistente(): Promise<ResultadoCierre> {
  encolarCierre();
  return confirmarCierrePersistente();
}

/** true si el último cierre no pudo confirmarse en el almacén cifrado. */
export function hayCierrePendiente(): boolean {
  return cierrePendiente;
}

/**
 * Carga los tokens cifrados al espejo en memoria. Idempotente y sin lanzar:
 * si el almacén falla, la sesión simplemente no se recupera y se muestra el
 * login. Se espera antes de `haySesionValida()` para no decidir con el espejo
 * vacío. Una marca de cierre pendiente impide aceptar la sesión anterior.
 */
export function hidratarSesion(): Promise<void> {
  if (hidratando) return hidratando;

  hidratando = (async () => {
    if (cierrePendiente) return;

    const marcador = await leerPersistido(CLAVE_MARCADOR);
    if (marcador === VALOR_MARCADOR) {
      cierrePendiente = true;
      const resultado = await reintentarCierrePersistente();
      if (!resultado.ok) return;
    }

    for (const clave of CLAVES) {
      // Si mientras se lee la app escribe o cierra sesión, esa generación es
      // la verdad: no se reinyecta el valor viejo del almacén.
      const gen = generacion.get(clave) ?? 0;
      const valor = await leerPersistido(clave);
      if (valor === null || valor === VALOR_CENTINELA) continue;
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
  operaciones.clear();
  hidratando = null;
  disponible = true;
  cierrePendiente = false;
  cierreEnCurso = false;
}

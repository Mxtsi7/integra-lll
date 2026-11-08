// Doble de pruebas de expo-secure-store. Guarda en memoria y expone la misma
// API asíncrona que usan src/services/storageSeguro.ts y src/storage/sesionSegura.ts.
const store = new Map<string, string>();

type Demora = { promesa: Promise<void>; liberar: () => void };

let demoraEscritura: Demora | null = null;
let demoraLectura: Demora | null = null;
let fallarBorrados = false;

function crearDemora(): Demora {
  let liberar!: () => void;
  const promesa = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  return { promesa, liberar };
}

/** Retiene la próxima escritura (setItemAsync) hasta llamar a `__liberar`. */
export function __retenerSiguienteEscritura(): void {
  demoraEscritura = crearDemora();
}

/**
 * Retiene la próxima lectura (getItemAsync) *después* de capturar el valor:
 * simula un almacén que devuelve un dato ya obsoleto.
 */
export function __retenerSiguienteLectura(): void {
  demoraLectura = crearDemora();
}

/** Libera las demoras pendientes. */
export function __liberar(): void {
  demoraEscritura?.liberar();
  demoraEscritura = null;
  demoraLectura?.liberar();
  demoraLectura = null;
}

/** Simula un keystore que rechaza los borrados. */
export function __fallarBorrados(fallar = true): void {
  fallarBorrados = fallar;
}

export async function getItemAsync(clave: string): Promise<string | null> {
  const valor = store.get(clave) ?? null;
  if (demoraLectura) await demoraLectura.promesa;
  return valor;
}

export async function setItemAsync(clave: string, valor: string): Promise<void> {
  if (demoraEscritura) await demoraEscritura.promesa;
  store.set(clave, valor);
}

export async function deleteItemAsync(clave: string): Promise<void> {
  if (fallarBorrados) throw new Error('deleteItemAsync rechazado');
  store.delete(clave);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';

/** Deja el doble como recién instalado. */
export function __limpiar(): void {
  store.clear();
  demoraEscritura = null;
  demoraLectura = null;
  fallarBorrados = false;
}

export function __limpiarStoreParaPruebas(): void {
  store.clear();
}

export function __obtenerStoreParaPruebas(): Map<string, string> {
  return store;
}
